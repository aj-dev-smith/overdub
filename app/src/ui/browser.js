// The browser: every sound Overdub can make, searchable. Devices written in this song (by you or an agent), the
// instruments, the effects by category, and the guitar rigs (whole boards) by bank. Drag drops onto the arranger or
// the rack:   'application/x-overdub-device'  { id, kind }      'application/x-overdub-rig'  { id, name }
//
// An instrument tries, it never overwrites (docs/INSTRUMENTS-UX.md 2.4). A click (or a tap: the same rules) on one:
//   - no instrument track to put it on (an audio track, the master, no tracks), or a track with no instrument yet:
//     a new track with it, or it goes on, as before (nothing is replaced, so there's nothing to try);
//   - a mismatch (rack.isMismatch: a melodic instrument on a drum track, a kit on a pitched track with notes): a menu
//     at the row, "New track with Light Table" first and focused, then "On Drums anyway" (which tries it);
//   - the instrument the track plays already: the line says so, with Open;
//   - otherwise a trial on the selected track (app.sounds.try: a preview, never in History), and the line over the
//     list becomes the trial bar, "Trying Light Table on Keys." with Keep and Back. Another click tries that one
//     instead. Esc in the browser is Back; selecting another track or closing the pane is Back too.
// Shift-click and Shift+Enter put an instrument on a new track straight away. Effects go on the end of the chain as
// before (they take nothing away; Undo is in the toast), and a rig over a chain still asks first on a touch screen.
// The trial is app.sounds' (ui/sounds.js) when the studio has it; until then the browser keeps one of its own here
// (localTrials), with the same calls.
// Keys: / searches (from anywhere), ↑ ↓ move, Enter tries or adds, Shift+Enter puts an instrument on a new track,
// Esc goes back from a trial, else clears.
// The genre filter (All, Bass music: GENRE_FILTERS, the registry's preset tags): a genre lists its sounds first, each
// preset tagged with it as a row of its own ("Fixer", Light Table, its blurb). An instrument's tries on the selected
// track (with that preset), an effect's goes on the end of the chain with it. The choice lasts the session.

import { kitHashes, kitState, kitLine, prefetchKit } from './kitload.js';
import { h, css, icon, byline } from './dom.js';
import { DEVICE_CATS, presetParams } from '../devices/registry.js';
import {
  addDevice,
  applyRig,
  guitar,
  swatchOf,
  authorKind,
  authorName,
  currentTrack,
  rankDevices,
  isMismatch,
} from './rack.js';
import { songColor, touchFirst, menu } from './arrange-kit.js';

const DT_DEV = 'application/x-overdub-device',
  DT_RIG = 'application/x-overdub-rig';
const PREF = 'overdub:browser';
// the genres the filter offers: [tag, label] (a genre's presets carry its tag: devices/registry.js PRESET_TAGS)
export const GENRE_FILTERS = [
  ['', 'All'],
  ['bass-music', 'Bass music'],
];
const catName = (c) => (DEVICE_CATS.find(([k]) => k === c) || [c, c ? c[0].toUpperCase() + c.slice(1) : 'Other'])[1];

export default async function (app) {
  const { store, ui, devices } = app;
  css('ew-browser', BROWSER_CSS);
  const g = await Promise.race([guitar(), new Promise((r) => setTimeout(() => r(null), 2000))]);
  let prefs = { closed: { 'fx:': true, rigs: true } };
  try {
    const s = JSON.parse(localStorage.getItem(PREF) || 'null');
    if (s?.closed) prefs = s;
  } catch (e) {
    /* fresh */
  }
  const savePrefs = () => {
    try {
      localStorage.setItem(PREF, JSON.stringify(prefs));
    } catch (e) {
      /* private mode */
    }
  };
  let view = null;
  const local = localTrials(app);
  // the trials: app.sounds once ui/sounds.js is in the studio, else the browser's own (same calls)
  const S = () => (app.sounds?.try && app.sounds?.trying ? app.sounds : local);
  // a trial the browser started (its endings are the browser's to call: Esc here, another track, the pane closing)
  let mine = null;

  ui.panel({
    id: 'browser',
    region: 'left',
    title: 'Browser',
    icon: 'search',
    order: 10,
    mount(el) {
      const q = h('input.br-q', {
        type: 'search',
        placeholder: 'Sounds, effects, rigs…',
        'aria-label': 'Search devices and rigs',
        autocomplete: 'off',
        spellcheck: false,
      });
      const target = h('div.br-target');
      // the genre filter: All, or a genre's sounds first
      let genre = ui.state.browserGenre || '';
      const gbtns = GENRE_FILTERS.map(([tag, label]) =>
        h(
          'button.br-g',
          {
            type: 'button',
            'aria-pressed': String(tag === genre),
            dataset: { genre: tag },
            onclick: () => {
              genre = tag;
              ui.state.browserGenre = tag;
              for (const b of gbtns) b.setAttribute('aria-pressed', String(b.dataset.genre === genre));
              render();
            },
          },
          label,
        ),
      );
      const gfilter = h('div.br-genres', { role: 'group', 'aria-label': 'Genre' }, ...gbtns);
      const list = h('div.br-list', { role: 'listbox', 'aria-label': 'Devices' });
      el.append(
        h('div.br', h('label.br-search', icon('search', { size: 15 }), q, h('kbd', '/')), gfilter, target, list),
      );
      let rows = []; // the visible, pickable rows in order: { el, kind: 'device' | 'rig', item }
      let at = -1;
      let dirty = false;

      el.addEventListener(
        'pointerdown',
        () => {
          ui.state.focus = 'browser';
        },
        true,
      );

      // What a click does, said before it's done: "Click tries it on Keys." (Keep it or go back after); while a sound
      // is on trial, the trial bar: "Trying Light Table on Keys." with Keep and Back. It once said "Click puts it on",
      // and a click swapped the track's instrument out.
      let already = null; // { track, device }: "Keys plays Light Table already." after a click on what it plays
      const trackChip = (t) => h('b', h('i', { style: { background: songColor(t.color) } }), t.name);
      const devName = (id) => devices.getDevice(id)?.name || devices.heldDevice?.(id)?.name || id;
      function renderTarget() {
        const tr = S().trying();
        const tt = tr && store.track(tr.track);
        target.classList.toggle('br-trial', !!tt);
        if (tt) {
          const td = devices.getDevice(tr.device);
          target.replaceChildren(
            h(
              'span.br-target-line',
              'Trying ',
              h('b', devName(tr.device)),
              ' on ',
              trackChip(tt),
              '.',
              td && kitHashes(td).length && kitState(td) !== 'ready' ? [' ', kitLine(td)] : null,
            ),
            h(
              'span.br-trial-acts',
              h(
                'button.btn.btn-go.br-keep',
                {
                  type: 'button',
                  title: `Keep ${devName(tr.device)} on ${tt.name} (one undo step)`,
                  onclick: () => keepTrial(),
                },
                'Keep',
              ),
              h(
                'button.btn.btn-txt.br-back',
                { type: 'button', title: `Back to ${devName(realDevice(tt, tr))}`, onclick: () => backTrial('back') },
                'Back',
              ),
            ),
          );
          return;
        }
        const id = currentTrack(app);
        const t = id && id !== 'master' ? store.track(id) : null;
        if (already && t && already.track === t.id && t.instrument?.device === already.device) {
          const name = devName(already.device);
          target.replaceChildren(
            h('span.br-target-line', trackChip(t), ' plays ', h('b', name), ' already.'),
            app.plugin?.open
              ? h(
                  'button.btn.btn-txt.br-open',
                  {
                    type: 'button',
                    title: `Open ${name} big: its sound, presets and a keyboard`,
                    onclick: () => app.plugin.open({ track: t.id, slot: 'instrument' }),
                  },
                  'Open',
                )
              : null,
          );
          return;
        }
        already = null;
        // (a touch screen taps, and has no drag and drop out of a sheet that covers the studio)
        const touch = touchFirst();
        const tries = !!playsNow(t);
        // (a kit track: a click tries a kit on it, and asks first for anything else, "a new track or on Drums anyway")
        const kitT = tries && isKitTrack(t);
        const more = !t
          ? null
          : tries
            ? kitT
              ? `Another instrument asks first: a track of its own, or on ${t.name} anyway.`
              : 'Keep it or go back after.'
            : t.kind === 'audio'
              ? 'An instrument gets a new track of its own.'
              : null;
        const verb = touch
          ? tries
            ? kitT
              ? 'Tap tries a kit on'
              : 'Tap tries it on'
            : 'Tap puts it on'
          : tries
            ? kitT
              ? 'Click tries a kit on'
              : 'Click tries it on'
            : 'Click puts it on';
        const lead = tries
          ? [h('span.br-target-line', verb + ' ', trackChip(t), '.')]
          : [
              h('span', verb),
              t ? trackChip(t) : h('b', id === 'master' ? 'the master' : 'a new track'),
              touch ? null : h('span.ew-muted', 'or drag'),
            ];
        target.replaceChildren(...[...lead, more ? h('small.br-target-more', more) : null].filter(Boolean));
      }
      // the instrument a track plays now, by name (a device kept off here by the song's name for it), or null
      function playsNow(t) {
        if (!t || t.kind !== 'instrument' || !t.instrument?.device) return null;
        return devName(realDevice(t));
      }
      // what a track really plays: during a trial on it, the instrument the trial will go back to
      function realDevice(t, tr = S().trying()) {
        if (!t?.instrument) return null;
        if (!tr || tr.track !== t.id) return t.instrument.device;
        const w = tr.was;
        if (w && typeof w === 'object') return w.device || t.instrument.device;
        if (typeof w === 'string')
          return devices.getDevice(w) || devices.heldDevice?.(w)
            ? w
            : devices.listDevices().find((d) => d.name === w)?.id || t.instrument.device;
        return t.instrument.device;
      }
      // the track as it really is, for the mismatch rule (during a trial, with its own instrument back)
      const realTrack = (t) =>
        t && t.instrument ? { ...t, instrument: { ...t.instrument, device: realDevice(t) } } : t;
      const isKitTrack = (t) => {
        const d = realDevice(t);
        return d === 'core.drums' || devices.getDevice(d)?.cat === 'drums';
      };

      // the author's name in their ink (a byline); .badge-* stays on it for the checks that look for it. A device that
      // came through someone else's link says whose, as the track header does: "Sam via Jo"
      function signed(by) {
        const b = byline(by, { app, title: `Written by ${authorName(app, by)}` });
        if (b) b.classList.add(b.classList.contains('by-agent') ? 'badge-agent' : 'badge-human');
        return b;
      }
      const viaOf = (by, via) => (via && via !== by ? via : null);
      function credit(by, via) {
        const b = signed(by),
          v = b && viaOf(by, via);
        return v
          ? h(
              'span.br-by',
              { title: `Written by ${authorName(app, by)}, via ${authorName(app, v)}’s link` },
              b,
              ' via ',
              byline(v, { app }) || authorName(app, v),
            )
          : b;
      }
      function row(d, { tag } = {}) {
        const sw = swatchOf(d);
        const pd = store.get().devices?.[d.id],
          by = pd?.by || d.by;
        const ak = d.source === 'project' || d.source === 'library' || pd ? authorKind(app, by) : null;
        const r = h(
          'div.br-row',
          {
            role: 'option',
            tabindex: -1,
            draggable: 'true',
            dataset: { device: d.id, kind: d.kind },
            title: [
              d.name,
              d.blurb,
              d.nod ? `Tips its hat to ${d.nod}.` : '',
              d.kind === 'instrument'
                ? 'Click: try it on the selected track. Shift-click: a new track'
                : 'Click: on the end of the selected track’s chain',
            ]
              .filter(Boolean)
              .join('\n'),
          },
          h('i.br-sw', { style: { background: sw.color, '--ink': sw.ink } }),
          h('span.br-n', d.name),
          (ak && credit(by, pd?.via || d.via)) || h('small.br-tag', tag || d.kindLabel || ''),
          d.blurb ? h('span.br-blurb', d.blurb) : null,
        );
        r.addEventListener('click', (e) => {
          if (e.detail > 1) return;
          pickDevice(d, e.shiftKey, r);
        });
        // a sampled instrument's samples start coming when the pointer or focus rests on it, so a click hears it
        // (ui/kitload.js); the row says how far along they are until they're in
        if (d.kind === 'instrument' && kitHashes(d).length) {
          const early = () => {
            if (kitState(d) == null) prefetchKit(d);
          };
          r.addEventListener('pointerenter', early);
          r.addEventListener('focus', early);
          if (kitState(d) !== 'ready') r.append(kitLine(d, { short: true }));
        }
        // a double-click keeps it (a DAW's habit: double-click loads): the first click tried it, the second keeps it
        r.addEventListener('dblclick', (e) => {
          if (e.shiftKey || d.kind !== 'instrument') return;
          const tr = S().trying();
          if (tr && tr.device === d.id && !tr.newTrack) keepTrial();
        });
        r.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData(DT_DEV, JSON.stringify({ id: d.id, kind: d.kind }));
          e.dataTransfer.setData('text/plain', d.id);
          e.dataTransfer.effectAllowed = 'copy';
          r.classList.add('dragging');
        });
        r.addEventListener('dragend', () => r.classList.remove('dragging'));
        rows.push({ el: r, kind: 'device', item: d });
        return r;
      }
      // a preset as a row (the genre filter): its name, the device's swatch and name, its blurb; a click tries it (an
      // instrument, on the selected track) or puts it on (an effect, at the end of the chain)
      function presetRow(d, pr) {
        const sw = swatchOf(d);
        const r = h(
          'div.br-row.br-pre',
          {
            role: 'option',
            tabindex: -1,
            dataset: { device: d.id, kind: d.kind, preset: pr.name },
            title: [
              `${pr.name}: ${d.name}`,
              pr.blurb || '',
              d.kind === 'instrument'
                ? 'Click: try it on the selected track'
                : 'Click: on the end of the selected track’s chain',
            ]
              .filter(Boolean)
              .join('\n'),
          },
          h('i.br-sw', { style: { background: sw.color, '--ink': sw.ink } }),
          h('span.br-n', pr.name),
          h('small.br-tag', d.name),
          pr.blurb ? h('span.br-blurb', pr.blurb) : null,
        );
        r.addEventListener('click', () => pickPreset(d, pr, r));
        rows.push({ el: r, kind: 'preset', item: d, preset: pr.name });
        return r;
      }
      function pickPreset(d, pr, anchor) {
        if (d.kind !== 'instrument') {
          const id = currentTrack(app) || 'master',
            params = presetParams(d, pr.name) || {};
          const res = store.dispatch(
            { type: 'insert.add', track: id, insert: { device: d.id, params } },
            { by: 'you', label: `${d.name}: ${pr.name}` },
          );
          if (!res.ok) ui.toast(res.error, { kind: 'bad' });
          else
            ui.toast(`${d.name} (${pr.name}) is on the end of the chain.`, {
              kind: 'ok',
              action: { label: 'Undo', run: () => store.undo() },
            });
          return;
        }
        const id = currentTrack(app),
          t = id && id !== 'master' ? store.track(id) : null;
        if (!t || t.kind !== 'instrument' || !t.instrument?.device) {
          const r = store.dispatch(
            {
              type: 'track.add',
              ref: 'n',
              track: {
                name: pr.name,
                kind: 'instrument',
                instrument: { device: d.id, params: presetParams(d, pr.name) || {} },
              },
            },
            { by: 'you', label: `new track: ${pr.name}` },
          );
          if (r.ok) {
            ui.select({ track: r.created.n, clip: null, insert: null });
            ui.toast(`${pr.name} (${d.name}) is on a new track.`, {
              kind: 'ok',
              action: { label: 'Undo', run: () => store.undo() },
            });
          }
          return;
        }
        const res = S().try(t.id, { device: d.id, preset: pr.name }, { from: 'browser' });
        if (res && res.ok === false) {
          if (res.error) ui.toast(res.error, { kind: 'bad' });
          return;
        }
        mine = { track: t.id };
        already = null;
        renderTarget();
      }
      // a device the song brought whose code hasn't run here (main.js holds it): listed, kept off, never added from here
      function heldRow(d) {
        const sw = swatchOf(d);
        // (kept off where the byline goes, as the track header has it; who made it and whose link brought it, in its title)
        const v = viaOf(d.by, d.via);
        const r = h(
          'div.br-row.br-held',
          {
            role: 'option',
            tabindex: -1,
            dataset: { device: d.id, kind: d.kind, held: '1' },
            title: `${d.name}: kept off. It came with the song${v ? `, by ${authorName(app, d.by)} via ${authorName(app, v)}` : ''}, and its code hasn’t run on this computer.`,
          },
          h('i.br-sw', { style: { background: sw.color, '--ink': sw.ink } }),
          h('span.br-n', d.name),
          h('small.br-tag', 'kept off'),
          d.blurb ? h('span.br-blurb', d.blurb) : null,
        );
        r.addEventListener('click', () => askHeld(d));
        rows.push({ el: r, kind: 'held', item: d });
        return r;
      }
      function askHeld(d) {
        ui.toast(`${d.name} is kept off: it came with the song, and its code hasn’t run on this computer.`, {
          action: {
            label: 'Play it',
            run: () => {
              const res = app.trust?.play?.([d.id]);
              if (res?.ok)
                ui.toast(`${d.name} is on. This browser runs that code from now on, in any song.`, {
                  kind: 'ok',
                  ms: 6000,
                });
            },
          },
        });
      }
      function rigRow(rig) {
        const on = rig.chain.filter((c) => c.on).length;
        const amp = devices.getDevice(rig.amp)?.name || '';
        const r = h(
          'div.br-row.br-rig',
          {
            role: 'option',
            tabindex: -1,
            draggable: 'true',
            dataset: { rig: rig.id },
            title: [
              rig.name,
              rig.blurb,
              rig.nod ? `Tips its hat to ${rig.nod}.` : '',
              `${on} devices on${amp ? ' · ' + amp : ''}`,
              'Click: put this board on the selected track (replaces its effects; Undo puts them back)',
            ]
              .filter(Boolean)
              .join('\n'),
          },
          h('i.br-sw.br-sw-rig', { style: { background: rig.bank.color } }),
          h('span.br-n', rig.name),
          h('small.br-tag', `${on} on`),
          h('span.br-blurb', [rig.blurb, amp].filter(Boolean).join(' · ')),
        );
        r.addEventListener('click', () => pickRig(rig, r));
        r.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData(DT_RIG, JSON.stringify({ id: rig.id, name: rig.name }));
          e.dataTransfer.setData('text/plain', rig.name);
          e.dataTransfer.effectAllowed = 'copy';
        });
        rows.push({ el: r, kind: 'rig', item: rig });
        return r;
      }

      function section(key, title, count, kids, { badge, open } = {}) {
        const closed = open ? false : !!prefs.closed[key];
        const head = h(
          'button.br-sec',
          {
            'aria-expanded': String(!closed),
            onclick: () => {
              prefs.closed[key] = !prefs.closed[key];
              savePrefs();
              render();
            },
          },
          icon('chevron', { size: 13 }),
          h('span', title),
          badge || null,
          h('em', String(count)),
        );
        return h('div.br-group' + (closed ? '.closed' : ''), head, closed ? null : h('div.br-rows', kids));
      }

      function render() {
        dirty = false;
        rows = [];
        const s = q.value.trim().toLowerCase();
        const searching = !!s;
        const match = (d) =>
          !s ||
          (
            d.id +
            ' ' +
            d.name +
            ' ' +
            (d.blurb || '') +
            ' ' +
            (d.nod || '') +
            ' ' +
            (d.kindLabel || '') +
            ' ' +
            catName(d.cat)
          )
            .toLowerCase()
            .includes(s);
        const proj = store.get().devices || {};
        const all = devices.listDevices();
        const held = (devices.heldDevices?.() || []).filter((d) => match(d));
        const heldIds = new Set(held.map((d) => d.id));
        const mine = all.filter((d) => (d.source === 'project' || proj[d.id]) && !heldIds.has(d.id) && match(d));
        const builtins = all.filter((d) => !(d.source === 'project' || proj[d.id]));
        const out = [];
        // a genre's sounds: every preset tagged with it, a row each (its name, its device, its blurb), searched too
        if (genre) {
          const kids = [];
          for (const d of all)
            for (const pr of d.presets || []) {
              if (!(pr.tags || []).includes(genre)) continue;
              if (
                s &&
                !(pr.name + ' ' + (pr.blurb || '') + ' ' + d.name + ' ' + (pr.tags || []).join(' '))
                  .toLowerCase()
                  .includes(s)
              )
                continue;
              kids.push(presetRow(d, pr));
            }
          const label = (GENRE_FILTERS.find(([t]) => t === genre) || [undefined, genre])[1];
          out.push(
            section(
              'genre:' + genre,
              label,
              kids.length,
              kids.length ? kids : [h('div.br-none', `No ${label.toLowerCase()} sounds match.`)],
              { open: true },
            ),
          );
        }
        if (mine.length || held.length || !searching) {
          const kids =
            mine.length || held.length
              ? [...mine.map((d) => row(d)), ...held.map(heldRow)]
              : [
                  h(
                    'div.br-none',
                    'Nothing yet. Describe a sound to your agent and it can build an instrument or effect for this song.',
                    h(
                      'button.btn.br-ask',
                      {
                        onclick: () =>
                          ui.emit('agent:compose', {
                            text: 'Build me an effect that ',
                            attach: { track: currentTrack(app) },
                          }),
                      },
                      icon('agent', { size: 13 }),
                      'Build one with the agent',
                    ),
                  ),
                ];
          out.push(section('mine', 'Written in this song', mine.length + held.length, kids, { open: searching }));
        }
        for (const [kind, title, pre] of [
          ['instrument', 'Instruments', 'in:'],
          ['effect', 'Effects', 'fx:'],
        ]) {
          const ds = builtins.filter((d) => d.kind === kind && match(d));
          if (!ds.length && searching) continue;
          if (searching) {
            // one list per kind, best name match first
            if (ds.length)
              out.push(
                section(
                  pre,
                  title,
                  ds.length,
                  rankDevices(ds, s).map((d) => row(d, { tag: catName(d.cat) })),
                  { open: true },
                ),
              );
            continue;
          }
          const by = new Map();
          for (const d of ds) {
            if (!by.has(d.cat)) by.set(d.cat, []);
            by.get(d.cat).push(d);
          }
          const cats = [
            ...DEVICE_CATS.map(([k]) => k),
            ...[...by.keys()].filter((c) => !DEVICE_CATS.some(([k]) => k === c)),
          ];
          const kids = [];
          for (const c of cats) {
            const list2 = by.get(c);
            if (!list2) continue;
            if (by.size === 1 && kind === 'instrument') {
              kids.push(...list2.map((d) => row(d)));
              continue;
            }
            const key = pre + c;
            const closed = !searching && !!prefs.closed[key];
            kids.push(
              h(
                'div.br-sub' + (closed ? '.closed' : ''),
                h(
                  'button.br-subh',
                  {
                    'aria-expanded': String(!closed),
                    onclick: () => {
                      prefs.closed[key] = !prefs.closed[key];
                      savePrefs();
                      render();
                    },
                  },
                  icon('chevron', { size: 11 }),
                  catName(c),
                  h('em', String(list2.length)),
                ),
                closed ? null : list2.map((d) => row(d, { tag: kind === 'effect' ? d.kindLabel || '' : '' })),
              ),
            );
          }
          if (!ds.length)
            kids.push(
              h('div.br-none', kind === 'instrument' ? 'The instruments are still loading…' : 'No effects loaded yet.'),
            );
          out.push(section(pre, title, ds.length, kids, { open: searching }));
        }
        // From the community (ui/community.js): code someone else wrote, so its rows behave differently on purpose (tap
        // hears it; Try asks first). Its rows join the keyboard list here, in the order they're drawn.
        const cs = app.community?.section?.({ q: s, searching, prefs, savePrefs, render });
        if (cs) {
          out.push(cs.el);
          rows.push(...cs.rows);
        }
        if (g?.RIGS?.length) {
          const kids = [];
          let n = 0;
          for (const b of g.RIG_BANKS || []) {
            const rs = g.RIGS.filter(
              (r) =>
                r.bank.id === b.id &&
                (!s ||
                  (r.name + ' ' + r.blurb + ' ' + (r.nod || '') + ' ' + (r.tags || []).join(' ') + ' ' + b.name)
                    .toLowerCase()
                    .includes(s)),
            );
            if (!rs.length) continue;
            n += rs.length;
            const key = 'rig:' + b.id;
            const closed = !searching && prefs.closed[key] !== false;
            kids.push(
              h(
                'div.br-sub' + (closed ? '.closed' : ''),
                h(
                  'button.br-subh',
                  {
                    'aria-expanded': String(!closed),
                    title: b.blurb,
                    onclick: () => {
                      prefs.closed[key] = !closed;
                      savePrefs();
                      render();
                    },
                  },
                  icon('chevron', { size: 11 }),
                  h('i.br-bank', { style: { background: b.color } }),
                  b.name,
                  h('em', String(rs.length)),
                ),
                closed ? null : rs.map(rigRow),
              ),
            );
          }
          if (n || !searching)
            out.push(
              section('rigs', 'Guitar rigs', n, kids, { open: searching, badge: h('span.br-new', 'whole boards') }),
            );
        }
        if (searching && !rows.length)
          out.push(
            h(
              'div.br-none.br-miss',
              h('b', `No “${q.value}” here yet.`),
              h('span', 'Your agent can build it: describe how it should sound.'),
              h(
                'button.btn.br-ask',
                {
                  onclick: () =>
                    ui.emit('agent:compose', {
                      text: `Build me ${/synth|keys|bass|drum|pad|lead|pluck/i.test(q.value) ? 'an instrument' : 'an effect'}: ${q.value}`,
                      attach: { track: currentTrack(app) },
                    }),
                },
                icon('agent', { size: 13 }),
                `Ask for “${q.value}”`,
              ),
            ),
          );
        list.replaceChildren(...out);
        at = searching && rows.length ? 0 : Math.min(at, rows.length - 1);
        highlight(false);
        renderTarget();
      }

      function highlight(scroll = true) {
        rows.forEach((r, i) => {
          r.el.classList.toggle('on', i === at);
          r.el.setAttribute('aria-selected', String(i === at));
        });
        if (scroll && rows[at]) rows[at].el.scrollIntoView({ block: 'nearest' });
        // (the keys resting on a sampled instrument start its samples coming, as the pointer does)
        const it = scroll && rows[at]?.kind === 'device' ? rows[at].item : null;
        if (it && it.kind === 'instrument' && kitHashes(it).length && kitState(it) == null) prefetchKit(it);
      }

      function newTrackWith(d) {
        // (a trial elsewhere goes back first: the new track is the choice)
        if (S().trying()) backTrial('new');
        const r = store.dispatch(
          {
            type: 'track.add',
            ref: 'n',
            track: { name: d.name, kind: 'instrument', instrument: { device: d.id, params: {} } },
          },
          { by: 'you', label: `new track: ${d.name}` },
        );
        if (r.ok) {
          ui.select({ track: r.created.n, clip: null, insert: null });
          // (what happened, then how notes get onto it: the track is empty, and selected, so R records onto it)
          const how = touchFirst() ? 'Tap ● and play to put notes on it.' : 'Press `R` and play to put notes on it.';
          ui.toast(`${d.name} is on a new track. ${how}`, {
            kind: 'ok',
            action: { label: 'Undo', run: () => store.undo() },
          });
        }
        return r;
      }
      function startTrial(d, t) {
        const res = S().try(t.id, { device: d.id }, { from: 'browser' });
        if (res && res.ok === false) {
          if (res.error) ui.toast(res.error, { kind: 'bad' });
          return;
        }
        mine = { track: t.id };
        already = null;
        renderTarget();
      }
      function keepTrial() {
        const tr = S().trying();
        if (!tr) return;
        mine = null;
        S().keep();
        renderTarget();
      }
      function backTrial(why) {
        mine = null;
        const r = S().trying() ? S().back({ why }) : false;
        renderTarget();
        return r;
      }
      function pickDevice(d, newTrack, anchor = null) {
        if (d.kind !== 'instrument') {
          addDevice(app, d.id);
          return;
        }
        if (newTrack) {
          newTrackWith(d);
          return;
        }
        const id = currentTrack(app),
          t = id && id !== 'master' ? store.track(id) : null;
        // nothing to replace (no instrument track here, or one with no instrument yet): it goes on, as it always did
        if (!t || t.kind !== 'instrument' || !t.instrument?.device) {
          if (S().trying()) backTrial('new');
          addDevice(app, d.id);
          return;
        }
        const real = realDevice(t),
          was = devName(real);
        // the instrument it plays: say so (a click on it during a trial is going back to it)
        if (real === d.id) {
          const tr = S().trying();
          if (tr && tr.track === t.id) backTrial('back');
          already = { track: t.id, device: d.id };
          renderTarget();
          return;
        }
        // the one on trial already: nothing new to hear
        const tr = S().trying();
        if (tr && tr.track === t.id && tr.device === d.id && !tr.preset) return;
        // a melodic instrument on a drum track, or a kit on a pitched track with notes: ask, a new track first
        if (isMismatch(d, realTrack(t), store.get())) {
          const kit = d.cat === 'drums' || d.id === 'core.drums';
          menu(
            anchor || q,
            [
              { head: d.name },
              { label: `New track with ${d.name}`, sub: `${t.name} keeps ${was}`, run: () => newTrackWith(d) },
              {
                label: `On ${t.name} anyway`,
                sub: kit ? `its notes play as ${d.name}’s drums` : `its hits play as ${d.name}’s notes`,
                run: () => startTrial(d, t),
              },
            ],
            { label: `Where ${d.name} goes` },
          );
          return;
        }
        startTrial(d, t);
      }
      function pickRig(rig, anchor = null) {
        // (a finger: a rig over a chain of effects asks first, as an instrument does)
        const id = currentTrack(app),
          list = id === 'master' ? store.get().master.inserts : store.track(id)?.inserts || [];
        if (touchFirst() && list.length) {
          const tn = id === 'master' ? 'the master' : store.track(id)?.name || 'the track';
          menu(
            anchor || q,
            [
              { head: rig.name },
              {
                label: `On ${tn}`,
                sub: `in place of its ${list.length} effect${list.length > 1 ? 's' : ''}`,
                run: () => applyRig(app, rig),
              },
            ],
            { label: `Put ${rig.name} on ${tn}?` },
          );
          return;
        }
        applyRig(app, rig);
      }

      q.addEventListener('input', () => render());
      q.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          at = Math.min(rows.length - 1, at + 1);
          highlight();
        } else if (e.key === 'ArrowUp') {
          at = Math.max(0, at - 1);
          highlight();
        } else if (e.key === 'Enter') {
          const r = rows[at];
          if (!r) return;
          if (r.kind === 'rig') pickRig(r.item, r.el);
          else if (r.kind === 'community') r.enter?.();
          else if (r.kind === 'held') askHeld(r.item);
          else if (r.kind === 'preset')
            pickPreset(
              r.item,
              (r.item.presets || []).find((x) => x.name === r.preset),
              r.el,
            );
          else pickDevice(r.item, e.shiftKey, r.el);
        } else if (e.key === 'Escape') {
          if (S().trying()) backTrial('esc');
          else if (q.value) {
            q.value = '';
            render();
          } else q.blur();
        } else return;
        e.preventDefault();
      });

      const offDev = devices.onDevices?.(() => {
        if (!dirty) {
          dirty = true;
          setTimeout(() => dirty && render(), 60);
        }
      });
      // another track selected, or the browser put away, while a trial it started runs: back, and the toast offers
      // Keep it (app.sounds says so; the browser's own trials say it themselves)
      const offSel = ui.on('select', () => {
        const tr = S().trying();
        if (
          mine &&
          tr &&
          tr.track === mine.track &&
          ui.state.selection.track &&
          ui.state.selection.track !== tr.track
        ) {
          mine = null;
          S().back({ why: 'select' });
        }
        renderTarget();
      });
      const offShut = ui.on('resize', () => {
        const tr = S().trying();
        if (mine && tr && !ui.visible('browser')) {
          mine = null;
          S().back({ why: 'closed' });
          renderTarget();
        }
      });
      const offShow = ui.on('show', ({ region }) => {
        const tr = S().trying();
        if (region === 'left' && mine && tr && !ui.visible('browser')) {
          mine = null;
          S().back({ why: 'closed' });
          renderTarget();
        }
      });
      const offTrial = local.on(renderTarget);
      const offKeyEsc = ui.keys.add({
        key: 'Escape',
        first: true,
        when: () => ui.state.focus === 'browser' && ui.visible('browser') && !!S().trying(),
        run: () => backTrial('esc'),
        label: 'Back from trying a sound',
        group: 'Browser',
      });
      render();
      view = {
        focus() {
          q.focus();
          q.select();
        },
        render,
      };

      return {
        update(evt) {
          if (mine && !S().trying()) mine = null;
          if (evt.kind === 'preview') {
            renderTarget();
            return;
          }
          if (
            evt.kind === 'load' ||
            evt.ops.some(
              (o) =>
                o.type?.startsWith('device.') ||
                o.type === 'track.add' ||
                o.type === 'track.remove' ||
                o.type === 'track.set' ||
                o.type === 'instrument.set',
            )
          ) {
            if (evt.ops.some((o) => o.type?.startsWith('device.')) || evt.kind === 'load') render();
            else renderTarget();
          }
        },
        refresh() {
          if (dirty) render();
        },
        unmount() {
          offDev?.();
          offSel();
          offShut();
          offShow();
          offTrial();
          offKeyEsc();
          if (mine && S().trying()) S().back({ why: 'closed' });
          mine = null;
          view = null;
        },
      };
    },
  });

  ui.keys.add({
    key: 'Slash',
    run: () => {
      ui.show('browser');
      if (!ui.isOpen('left')) ui.setOpen('left', true);
      setTimeout(() => view?.focus(), 0);
    },
    label: 'Search sounds and effects',
    group: 'Browser',
  });
  app.browser = {
    focus: () => {
      ui.show('browser');
      view?.focus();
    },
    render: () => view?.render(),
    search(text) {
      ui.show('browser');
      const inp = document.querySelector('.br-q');
      if (inp) {
        inp.value = text;
        inp.dispatchEvent(new Event('input'));
      }
    },
  };
}

// The browser's own trials, for a studio without app.sounds (ui/sounds.js): the same calls, kept small. A trial is a
// store.preview of one instrument.set (never in History); Keep releases it and dispatches the change, signed you, in
// one undo step that renames a track still named after its old instrument; Back releases it. It ends as the card's
// do (docs/INSTRUMENTS-UX.md 1.3): recording keeps it first; an agent tool that reads or changes the song, another
// song, the page hidden and the browser's own endings go back; the track going, or an edit that changes its
// instrument, lets go of it as it is (the edit stands).
const QUIET_TOOLS = new Set([
  'suggest_sounds',
  'get_variation_result',
  'say',
  'ask_human',
  'get_recording',
  'highlight',
]);
function localTrials(app) {
  const { store, ui, devices } = app;
  const fns = new Set();
  const told = () => {
    for (const f of [...fns]) {
      try {
        f();
      } catch (e) {
        console.error('browser trial', e);
      }
    }
  };
  const nameOf = (id) => devices.getDevice(id)?.name || devices.heldDevice?.(id)?.name || id;
  // (a track named after its old instrument takes the new one's name, so "Light Table plays Music Stands" says that)
  const keptLine = (tn, name, wasName, renamed) =>
    renamed ? `${tn} plays ${name} now, and takes its name.` : `${tn} plays ${name} now (was ${wasName}).`;
  let cur = null; // { track, device, preset, was, handle }
  const drop = () => {
    cur = null;
    told();
  };
  const api = {
    on(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    trying: () => (cur ? { track: cur.track, device: cur.device, preset: cur.preset, was: cur.was } : null),
    try(track, { device, preset } = {}) {
      const t = store.track(track);
      if (!t || t.kind !== 'instrument' || !devices.getDevice(device))
        return { ok: false, error: `No instrument "${device}"` };
      const was = cur && cur.track === track ? cur.was : t.instrument?.device;
      if (cur) {
        cur.handle.release();
        cur = null;
      }
      if (was === device && !preset) {
        told();
        return { ok: true, same: true };
      }
      const op = { type: 'instrument.set', track, device };
      if (preset) op.preset = preset;
      const handle = store.preview(op, { by: 'you' });
      if (!handle.ok) {
        told();
        return { ok: false, error: handle.error };
      }
      cur = { track, device, preset: preset || null, was, handle };
      told();
      return { ok: true };
    },
    keep({ how = null } = {}) {
      if (!cur) return null;
      const c = cur;
      cur = null;
      c.handle.release();
      const t = store.track(c.track);
      if (!t) {
        told();
        return null;
      }
      const name = nameOf(c.device),
        wasName = nameOf(c.was);
      const op = { type: 'instrument.set', track: c.track, device: c.device };
      if (c.preset) op.preset = c.preset;
      const ops = [op];
      // (a name that was its old instrument's says the new one; a name the person typed is never touched)
      if (t.name === wasName && name !== wasName) ops.push({ type: 'track.set', track: c.track, patch: { name } });
      const tn = t.name; // (before the rename)
      const r = store.dispatch(ops, { by: 'you', label: `${tn}: ${name} (was ${wasName})` });
      if (r.ok)
        ui.toast(
          how === 'rec' ? `Kept ${name} on ${tn}: you recorded with it.` : keptLine(tn, name, wasName, ops.length > 1),
          { kind: 'ok', action: { label: 'Undo', run: () => store.undo() } },
        );
      else ui.toast(r.error, { kind: 'bad' });
      told();
      return r;
    },
    back({ why = null } = {}) {
      if (!cur) return false;
      const c = cur;
      cur = null;
      c.handle.release();
      const t = store.track(c.track);
      // (another track, the pane put away: said, with the Keep it would have been)
      if (t && (why === 'select' || why === 'closed' || why === 'hidden')) {
        const name = nameOf(c.device);
        ui.toast(`Back to ${nameOf(c.was)} on ${t.name}; ${name} wasn’t kept.`, {
          action: {
            label: 'Keep it',
            run: () => {
              const tt = store.track(c.track);
              if (!tt || tt.instrument?.device !== c.was) return;
              const wasName = nameOf(c.was),
                ops = [
                  {
                    type: 'instrument.set',
                    track: c.track,
                    device: c.device,
                    ...(c.preset ? { preset: c.preset } : {}),
                  },
                ];
              if (tt.name === wasName && name !== wasName)
                ops.push({ type: 'track.set', track: c.track, patch: { name } });
              const tn = tt.name;
              const r = store.dispatch(ops, { by: 'you', label: `${tn}: ${name} (was ${wasName})` });
              if (r.ok)
                ui.toast(keptLine(tn, name, wasName, ops.length > 1), {
                  kind: 'ok',
                  action: { label: 'Undo', run: () => store.undo() },
                });
            },
          },
        });
      }
      told();
      return true;
    },
    keepIfTrying(track) {
      return !!cur && (track == null || cur.track === track) && !!api.keep({ how: 'rec' });
    },
  };
  store.on('change', (evt) => {
    if (!cur || evt.kind === 'preview') return;
    if (evt.kind === 'load') {
      drop();
      return;
    }
    // the track went, or an edit (an undo, an agent) changed what it plays: that edit stands, the trial is over
    const t = store.track(cur.track);
    if (!t || t.instrument?.device !== cur.device) drop();
  });
  ui.on('agent:tool', (e) => {
    if (cur && e?.phase === 'start' && !QUIET_TOOLS.has(e.name)) api.back({ why: 'agent' });
  });
  const rec = () => app.input?.recorder;
  let offRec = null;
  const hook = () => {
    if (offRec || !rec()?.on) return;
    offRec = rec().on('state', (e) => {
      if (cur && (e?.state === 'count' || e?.state === 'rec')) api.keepIfTrying();
    });
  };
  hook();
  ui.on('ready', hook);
  const hide = () => {
    if (cur) api.back({ why: 'hidden' });
  };
  window.addEventListener('pagehide', hide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hide();
  });
  return api;
}

const BROWSER_CSS = `
.br { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.br-search { display: flex; align-items: center; gap: 7px; margin: 12px 14px 6px; padding: 0 2px; height: 32px; border: 0; border-bottom: 1px solid var(--text-3); background: none; color: var(--text-3); }
.br-search:focus-within { border-bottom-color: var(--text); }
.br-q { flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; outline: none; }
.br-q::-webkit-search-cancel-button { filter: invert(.6); }
/* (its height doesn't change between the line and the trial bar: a second click lands on the row the first one did) */
.br-target { display: flex; align-items: center; align-content: flex-start; gap: 5px; flex-wrap: wrap; min-height: 72px; padding: 0 14px 10px; font-size: 11.5px; color: var(--text-3); border-bottom: var(--rule); }
.br-target b { display: inline-flex; align-items: center; gap: 5px; color: var(--text-2); font-weight: 600; }
.br-target b i { width: 8px; height: 8px; }
.br-target-more { flex-basis: 100%; font-size: 11.5px; line-height: 1.35; color: var(--text-3); }
.br-target-line { display: inline; line-height: 1.6; color: var(--text-2); font-size: 12.5px; }
.br-target-line b { vertical-align: bottom; }
.br-target-line b { color: var(--text); }
/* the trial bar: what's on trial, then the decision (Keep is the browser's one primary) */
.br-trial { row-gap: 8px; padding-top: 2px; }
.br-trial .br-target-line { flex-basis: 100%; }
.br-trial-acts { display: inline-flex; align-items: center; gap: 12px; }
.br-open { margin-left: 4px; }
@media (max-width: 900px) { .br-target-more { font-size: 12px; } .br-target { min-height: 84px; } }
.br-list { flex: 1; min-height: 0; overflow: auto; padding: 4px 0 24px; }
.br-group { margin-top: 2px; }
/* section heads are plain words, sentence case, with the count in mono at the right */
.br-sec { display: flex; align-items: center; gap: 6px; width: 100%; padding: 12px 14px 6px; border: 0; border-bottom: var(--rule); background: none; cursor: pointer; color: var(--text); font: 600 13px var(--font-ui); text-align: left; }
.br-sec:hover { color: var(--text); background: var(--bg-3); }
.br-sec em, .br-subh em { margin-left: auto; font: 500 11px var(--font-mono); font-style: normal; color: var(--text-3); }
.br-sec .ico, .br-subh .ico { transform: rotate(90deg); color: var(--text-3); }
.br-group.closed > .br-sec .ico, .br-sub.closed > .br-subh .ico { transform: none; }
.br-new { color: var(--text-3); font-size: 11.5px; font-weight: 400; }
.br-sub { margin: 0; }
.br-subh { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 14px 4px 20px; border: 0; background: none; cursor: pointer; color: var(--text-3); font: 600 12px var(--font-ui); text-align: left; }
.br-subh:hover { color: var(--text); }
.br-bank { width: 8px; height: 8px; }
.br-row { display: grid; grid-template-columns: 12px 1fr auto; align-items: center; column-gap: 9px; padding: 6px 14px 6px 20px; cursor: pointer; color: var(--text); outline: none; user-select: none; }
.br-sub .br-row { padding-left: 32px; }
.br-row:hover { background: var(--bg-3); }
/* the row the keys are on: reverse print */
.br-row.on { background: var(--text); color: var(--bg); }
.br-row.on .br-tag, .br-row.on .br-blurb, .br-row.on .by, .br-row.on .br-by { color: var(--bg); }
.br-row > .kitload { grid-column: 2 / -1; }
.br-row.on .kitload, .br-trial .kitload { color: inherit; } .br-row.on .kitload .kl-bar > i { background: var(--bg); }
.br-row.dragging { opacity: .5; }
.br-sw { width: 8px; height: 8px; }
.br-sw-rig { border-radius: 0; }
.br-n { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.br-row > .by, .br-by { font-size: 12.5px; }
.br-by { color: var(--text-3); white-space: nowrap; }
.br-tag { font-size: 11px; color: var(--text-3); white-space: nowrap; max-width: 90px; overflow: hidden; text-overflow: ellipsis; }
/* what it is, always, on one line (a row that grew on hover moved the rows under the pointer); the whole of it on the
   row picked and in its title */
.br-blurb { grid-column: 2 / -1; display: block; min-width: 0; font-size: 12px; line-height: 1.4; color: var(--text-3); padding-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.br-row.on .br-blurb { white-space: normal; }
.br-none { display: grid; gap: 10px; padding: 10px 14px 12px 20px; color: var(--text-2); font-size: 12.5px; line-height: 1.5; }
.br-miss b { color: var(--text); font-weight: 600; }
.br-ask { justify-self: start; }
.br-ask svg { color: var(--agent); }
.br-search kbd { flex: none; }
.br-genres { display: flex; gap: 4px; margin: 0 14px 6px; }
.br-g { height: 26px; padding: 0 9px; border: 1px solid var(--line-2); border-radius: 6px; background: none; color: var(--text-2); font: 500 12px/1 var(--font-ui); cursor: pointer; }
.br-g[aria-pressed="true"] { border-color: var(--text); color: var(--text); }
.br-g:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
`;
