// The browser: every sound Overdub can make, searchable. Devices written in this song (by you or an agent), the
// instruments, the effects by category, and the guitar rigs (whole boards) by bank. A click puts it on the selected
// track (an instrument in place of the track's instrument, or on a new track if it's an audio track; an effect on the
// end of the chain; a rig in place of the chain, undoably), with a toast, and the line over the list says so before
// you click ("Click puts it on Guitar. An instrument replaces DI Box"). Drag drops onto the arranger or the rack:
//   'application/x-overdub-device'  { id, kind }      'application/x-overdub-rig'  { id, name }
// A finger: a tap is how a phone looks at things, so a tap never swaps a sound out: an instrument tapped while the
// selected track plays one asks first (a new track with it, or on that track in place of what it plays), as does a rig
// over a chain of effects. An effect still goes on with a tap (it takes nothing away; Undo is in its toast).
// Keys: / searches (from anywhere), ↑ ↓ move, Enter adds, Shift+Enter puts an instrument on a new track, Esc clears.

import { h, css, icon, byline } from './dom.js';
import { DEVICE_CATS } from '../devices/registry.js';
import { addDevice, applyRig, guitar, swatchOf, authorKind, authorName, currentTrack, rankDevices } from './rack.js';
import { songColor, touchFirst, menu } from './arrange-kit.js';

const DT_DEV = 'application/x-overdub-device', DT_RIG = 'application/x-overdub-rig';
const PREF = 'overdub:browser';
const catName = (c) => (DEVICE_CATS.find(([k]) => k === c) || [c, c ? c[0].toUpperCase() + c.slice(1) : 'Other'])[1];

export default async function (app) {
  const { store, ui, devices } = app;
  css('ew-browser', BROWSER_CSS);
  const g = await Promise.race([guitar(), new Promise((r) => setTimeout(() => r(null), 2000))]);
  let prefs = { closed: { 'fx:': true, rigs: true } };
  try { const s = JSON.parse(localStorage.getItem(PREF) || 'null'); if (s?.closed) prefs = s; } catch (e) { /* fresh */ }
  const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch (e) { /* private mode */ } };
  let view = null;

  ui.panel({
    id: 'browser', region: 'left', title: 'Browser', icon: 'search', order: 10,
    mount(el) {
      const q = h('input.br-q', { type: 'search', placeholder: 'Sounds, effects, rigs…', 'aria-label': 'Search devices and rigs', autocomplete: 'off', spellcheck: false });
      const target = h('div.br-target');
      const list = h('div.br-list', { role: 'listbox', 'aria-label': 'Devices' });
      el.append(h('div.br', h('label.br-search', icon('search', { size: 15 }), q, h('kbd', '/')), target, list));
      let rows = [];   // the visible, pickable rows in order: { el, kind: 'device' | 'rig', item }
      let at = -1;
      let dirty = false;

      el.addEventListener('pointerdown', () => { ui.state.focus = 'browser'; }, true);

      // What a click does, said before it's done: where it goes, and what an instrument would take the place of
      // ("Click puts it on Guitar. An instrument replaces DI Box (Shift-click: a new track)"). It said "adds", and a
      // click swapped Guitar's instrument out.
      function renderTarget() {
        const id = currentTrack(app);
        const t = id && id !== 'master' ? store.track(id) : null;
        // (a touch screen taps, and has no drag and drop out of a sheet that covers the studio)
        const touch = touchFirst();
        const was = playsNow(t);
        const more = !t ? null : was ? (touch ? `An instrument asks first: in place of ${was}, or a new track.` : `An instrument replaces ${was} (Shift-click: a new track).`)
          : t.kind === 'audio' ? 'An instrument gets a new track of its own.' : null;
        target.replaceChildren(...[h('span', touch ? 'Tap puts it on' : 'Click puts it on'), t ? h('b', h('i', { style: { background: songColor(t.color) } }), t.name) : h('b', id === 'master' ? 'the master' : 'a new track'), touch ? null : h('span.ew-muted', 'or drag'),
          more ? h('small.br-target-more', more) : null].filter(Boolean));
      }
      // the instrument a track plays now, by name (a device kept off here by the song's name for it), or null
      function playsNow(t) {
        if (!t || t.kind !== 'instrument' || !t.instrument) return null;
        const dev = t.instrument.device;
        return devices.getDevice(dev)?.name || devices.heldDevice?.(dev)?.name || dev;
      }

      // the author's name in their ink (a byline); .badge-* stays on it for the checks that look for it. A device that
      // came through someone else's link says whose, as the track header does: "Sam via Jo"
      function signed(by) { const b = byline(by, { app, title: `Written by ${authorName(app, by)}` }); if (b) b.classList.add(b.classList.contains('by-agent') ? 'badge-agent' : 'badge-human'); return b; }
      const viaOf = (by, via) => (via && via !== by ? via : null);
      function credit(by, via) {
        const b = signed(by), v = b && viaOf(by, via);
        return v ? h('span.br-by', { title: `Written by ${authorName(app, by)}, via ${authorName(app, v)}’s link` }, b, ' via ', byline(v, { app }) || authorName(app, v)) : b;
      }
      function row(d, { tag } = {}) {
        const sw = swatchOf(d);
        const pd = store.get().devices?.[d.id], by = pd?.by || d.by;
        const ak = d.source === 'project' || d.source === 'library' || pd ? authorKind(app, by) : null;
        const r = h('div.br-row', { role: 'option', tabindex: -1, draggable: 'true', dataset: { device: d.id, kind: d.kind },
          title: [d.name, d.blurb, d.nod ? `Tips its hat to ${d.nod}.` : '', d.kind === 'instrument' ? 'Click: on the selected track, in place of its instrument. Shift-click: a new track' : 'Click: on the end of the selected track’s chain'].filter(Boolean).join('\n') },
          h('i.br-sw', { style: { background: sw.color, '--ink': sw.ink } }),
          h('span.br-n', d.name),
          (ak && credit(by, pd?.via || d.via)) || h('small.br-tag', tag || d.kindLabel || ''),
          d.blurb ? h('span.br-blurb', d.blurb) : null);
        r.addEventListener('click', (e) => pickDevice(d, e.shiftKey, r));
        r.addEventListener('dragstart', (e) => { e.dataTransfer.setData(DT_DEV, JSON.stringify({ id: d.id, kind: d.kind })); e.dataTransfer.setData('text/plain', d.id); e.dataTransfer.effectAllowed = 'copy'; r.classList.add('dragging'); });
        r.addEventListener('dragend', () => r.classList.remove('dragging'));
        rows.push({ el: r, kind: 'device', item: d });
        return r;
      }
      // a device the song brought whose code hasn't run here (main.js holds it): listed, kept off, never added from here
      function heldRow(d) {
        const sw = swatchOf(d);
        // (kept off where the byline goes, as the track header has it; who made it and whose link brought it, in its title)
        const v = viaOf(d.by, d.via);
        const r = h('div.br-row.br-held', { role: 'option', tabindex: -1, dataset: { device: d.id, kind: d.kind, held: '1' },
          title: `${d.name}: kept off. It came with the song${v ? `, by ${authorName(app, d.by)} via ${authorName(app, v)}` : ''}, and its code hasn’t run on this computer.` },
          h('i.br-sw', { style: { background: sw.color, '--ink': sw.ink } }),
          h('span.br-n', d.name),
          h('small.br-tag', 'kept off'),
          d.blurb ? h('span.br-blurb', d.blurb) : null);
        r.addEventListener('click', () => askHeld(d));
        rows.push({ el: r, kind: 'held', item: d });
        return r;
      }
      function askHeld(d) {
        ui.toast(`${d.name} is kept off: it came with the song, and its code hasn’t run on this computer.`, { action: { label: 'Play it', run: () => {
          const res = app.trust?.play?.([d.id]);
          if (res?.ok) ui.toast(`${d.name} is on. This browser runs that code from now on, in any song.`, { kind: 'ok', ms: 6000 });
        } } });
      }
      function rigRow(rig) {
        const on = rig.chain.filter((c) => c.on).length;
        const amp = devices.getDevice(rig.amp)?.name || '';
        const r = h('div.br-row.br-rig', { role: 'option', tabindex: -1, draggable: 'true', dataset: { rig: rig.id }, title: [rig.name, rig.blurb, rig.nod ? `Tips its hat to ${rig.nod}.` : '', `${on} devices on${amp ? ' · ' + amp : ''}`, 'Click: put this board on the selected track (replaces its effects; Undo puts them back)'].filter(Boolean).join('\n') },
          h('i.br-sw.br-sw-rig', { style: { background: rig.bank.color } }),
          h('span.br-n', rig.name),
          h('small.br-tag', `${on} on`),
          h('span.br-blurb', [rig.blurb, amp].filter(Boolean).join(' · ')));
        r.addEventListener('click', () => pickRig(rig, r));
        r.addEventListener('dragstart', (e) => { e.dataTransfer.setData(DT_RIG, JSON.stringify({ id: rig.id, name: rig.name })); e.dataTransfer.setData('text/plain', rig.name); e.dataTransfer.effectAllowed = 'copy'; });
        rows.push({ el: r, kind: 'rig', item: rig });
        return r;
      }

      function section(key, title, count, kids, { badge, open } = {}) {
        const closed = open ? false : !!prefs.closed[key];
        const head = h('button.br-sec', { 'aria-expanded': String(!closed), onclick: () => { prefs.closed[key] = !prefs.closed[key]; savePrefs(); render(); } },
          icon('chevron', { size: 13 }), h('span', title), badge || null, h('em', String(count)));
        return h('div.br-group' + (closed ? '.closed' : ''), head, closed ? null : h('div.br-rows', kids));
      }

      function render() {
        dirty = false;
        rows = [];
        const s = q.value.trim().toLowerCase();
        const searching = !!s;
        const match = (d) => !s || (d.id + ' ' + d.name + ' ' + (d.blurb || '') + ' ' + (d.nod || '') + ' ' + (d.kindLabel || '') + ' ' + catName(d.cat)).toLowerCase().includes(s);
        const proj = store.get().devices || {};
        const all = devices.listDevices();
        const held = (devices.heldDevices?.() || []).filter((d) => match(d));
        const heldIds = new Set(held.map((d) => d.id));
        const mine = all.filter((d) => (d.source === 'project' || proj[d.id]) && !heldIds.has(d.id) && match(d));
        const builtins = all.filter((d) => !(d.source === 'project' || proj[d.id]));
        const out = [];
        if (mine.length || held.length || !searching) {
          const kids = mine.length || held.length ? [...mine.map((d) => row(d)), ...held.map(heldRow)] : [h('div.br-none', 'Nothing yet. Describe a sound to your agent and it can build an instrument or effect for this song.', h('button.btn.br-ask', { onclick: () => ui.emit('agent:compose', { text: 'Build me an effect that ', attach: { track: currentTrack(app) } }) }, icon('agent', { size: 13 }), 'Build one with the agent'))];
          out.push(section('mine', 'Written in this song', mine.length + held.length, kids, { open: searching }));
        }
        for (const [kind, title, pre] of [['instrument', 'Instruments', 'in:'], ['effect', 'Effects', 'fx:']]) {
          const ds = builtins.filter((d) => d.kind === kind && match(d));
          if (!ds.length && searching) continue;
          if (searching) { // one list per kind, best name match first
            if (ds.length) out.push(section(pre, title, ds.length, rankDevices(ds, s).map((d) => row(d, { tag: catName(d.cat) })), { open: true }));
            continue;
          }
          const by = new Map();
          for (const d of ds) { if (!by.has(d.cat)) by.set(d.cat, []); by.get(d.cat).push(d); }
          const cats = [...DEVICE_CATS.map(([k]) => k), ...[...by.keys()].filter((c) => !DEVICE_CATS.some(([k]) => k === c))];
          const kids = [];
          for (const c of cats) {
            const list2 = by.get(c);
            if (!list2) continue;
            if (by.size === 1 && kind === 'instrument') { kids.push(...list2.map((d) => row(d))); continue; }
            const key = pre + c;
            const closed = !searching && !!prefs.closed[key];
            kids.push(h('div.br-sub' + (closed ? '.closed' : ''),
              h('button.br-subh', { 'aria-expanded': String(!closed), onclick: () => { prefs.closed[key] = !prefs.closed[key]; savePrefs(); render(); } }, icon('chevron', { size: 11 }), catName(c), h('em', String(list2.length))),
              closed ? null : list2.map((d) => row(d, { tag: kind === 'effect' ? (d.kindLabel || '') : '' }))));
          }
          if (!ds.length) kids.push(h('div.br-none', kind === 'instrument' ? 'The instruments are still loading…' : 'No effects loaded yet.'));
          out.push(section(pre, title, ds.length, kids, { open: searching }));
        }
        if (g?.RIGS?.length) {
          const kids = [];
          let n = 0;
          for (const b of g.RIG_BANKS || []) {
            const rs = g.RIGS.filter((r) => r.bank.id === b.id && (!s || (r.name + ' ' + r.blurb + ' ' + (r.nod || '') + ' ' + (r.tags || []).join(' ') + ' ' + b.name).toLowerCase().includes(s)));
            if (!rs.length) continue;
            n += rs.length;
            const key = 'rig:' + b.id;
            const closed = !searching && prefs.closed[key] !== false;
            kids.push(h('div.br-sub' + (closed ? '.closed' : ''),
              h('button.br-subh', { 'aria-expanded': String(!closed), title: b.blurb, onclick: () => { prefs.closed[key] = !closed; savePrefs(); render(); } }, icon('chevron', { size: 11 }), h('i.br-bank', { style: { background: b.color } }), b.name, h('em', String(rs.length))),
              closed ? null : rs.map(rigRow)));
          }
          if (n || !searching) out.push(section('rigs', 'Guitar rigs', n, kids, { open: searching, badge: h('span.br-new', 'whole boards') }));
        }
        if (searching && !rows.length) out.push(h('div.br-none.br-miss', h('b', `No “${q.value}” here yet.`), h('span', 'Your agent can build it: describe how it should sound.'),
          h('button.btn.br-ask', { onclick: () => ui.emit('agent:compose', { text: `Build me ${/synth|keys|bass|drum|pad|lead|pluck/i.test(q.value) ? 'an instrument' : 'an effect'}: ${q.value}`, attach: { track: currentTrack(app) } }) }, icon('agent', { size: 13 }), `Ask for “${q.value}”`)));
        list.replaceChildren(...out);
        at = searching && rows.length ? 0 : Math.min(at, rows.length - 1);
        highlight(false);
        renderTarget();
      }

      function highlight(scroll = true) {
        rows.forEach((r, i) => { r.el.classList.toggle('on', i === at); r.el.setAttribute('aria-selected', String(i === at)); });
        if (scroll && rows[at]) rows[at].el.scrollIntoView({ block: 'nearest' });
      }

      function pickDevice(d, newTrack, anchor = null) {
        if (d.kind === 'instrument' && newTrack) {
          const r = store.dispatch({ type: 'track.add', ref: 'n', track: { name: d.name, kind: 'instrument', instrument: { device: d.id, params: {} } } }, { by: 'you', label: `new track: ${d.name}` });
          if (r.ok) { ui.select({ track: r.created.n, clip: null, insert: null }); ui.toast(`New track with ${d.name}`, { kind: 'ok', action: { label: 'Undo', run: () => store.undo() } }); }
          return;
        }
        // a finger: a tap that would swap the selected track's instrument out asks where it goes first
        const id = currentTrack(app), t = id && id !== 'master' ? store.track(id) : null, was = playsNow(t);
        if (d.kind === 'instrument' && touchFirst() && was && t.instrument.device !== d.id) {
          menu(anchor || q, [{ head: d.name },
            { label: 'On a new track', sub: `${t.name} keeps ${was}`, run: () => pickDevice(d, true) },
            { label: `On ${t.name}`, sub: `in place of ${was}`, run: () => addDevice(app, d.id) }], { label: `Where ${d.name} goes` });
          return;
        }
        addDevice(app, d.id);
      }
      function pickRig(rig, anchor = null) {
        // (a finger: a rig over a chain of effects asks first, as an instrument does)
        const id = currentTrack(app), list = id === 'master' ? store.get().master.inserts : store.track(id)?.inserts || [];
        if (touchFirst() && list.length) {
          const tn = id === 'master' ? 'the master' : store.track(id)?.name || 'the track';
          menu(anchor || q, [{ head: rig.name }, { label: `On ${tn}`, sub: `in place of its ${list.length} effect${list.length > 1 ? 's' : ''}`, run: () => applyRig(app, rig) }], { label: `Put ${rig.name} on ${tn}?` });
          return;
        }
        applyRig(app, rig);
      }

      q.addEventListener('input', () => render());
      q.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { at = Math.min(rows.length - 1, at + 1); highlight(); }
        else if (e.key === 'ArrowUp') { at = Math.max(0, at - 1); highlight(); }
        else if (e.key === 'Enter') { const r = rows[at]; if (!r) return; if (r.kind === 'rig') pickRig(r.item, r.el); else if (r.kind === 'held') askHeld(r.item); else pickDevice(r.item, e.shiftKey, r.el); }
        else if (e.key === 'Escape') { if (q.value) { q.value = ''; render(); } else q.blur(); }
        else return;
        e.preventDefault();
      });

      const offDev = devices.onDevices?.(() => { if (!dirty) { dirty = true; setTimeout(() => dirty && render(), 60); } });
      const offSel = ui.on('select', renderTarget);
      render();
      view = { focus() { q.focus(); q.select(); }, render };

      return {
        update(evt) { if (evt.kind === 'load' || evt.ops.some((o) => o.type?.startsWith('device.') || o.type === 'track.add' || o.type === 'track.remove' || o.type === 'track.set' || o.type === 'instrument.set')) { if (evt.ops.some((o) => o.type?.startsWith('device.')) || evt.kind === 'load') render(); else renderTarget(); } },
        refresh() { if (dirty) render(); },
        unmount() { offDev?.(); offSel(); view = null; },
      };
    },
  });

  ui.keys.add({ key: 'Slash', run: () => { ui.show('browser'); if (!ui.isOpen('left')) ui.setOpen('left', true); setTimeout(() => view?.focus(), 0); }, label: 'Search sounds and effects', group: 'Browser' });
  app.browser = { focus: () => { ui.show('browser'); view?.focus(); }, search(text) { ui.show('browser'); const inp = document.querySelector('.br-q'); if (inp) { inp.value = text; inp.dispatchEvent(new Event('input')); } } };
}

const BROWSER_CSS = `
.br { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.br-search { display: flex; align-items: center; gap: 7px; margin: 12px 14px 6px; padding: 0 2px; height: 32px; border: 0; border-bottom: 1px solid var(--text-3); background: none; color: var(--text-3); }
.br-search:focus-within { border-bottom-color: var(--text); }
.br-q { flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 13px; outline: none; }
.br-q::-webkit-search-cancel-button { filter: invert(.6); }
.br-target { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; padding: 0 14px 10px; font-size: 11.5px; color: var(--text-3); border-bottom: var(--rule); }
.br-target b { display: inline-flex; align-items: center; gap: 5px; color: var(--text-2); font-weight: 600; }
.br-target b i { width: 8px; height: 8px; }
.br-target-more { flex-basis: 100%; font-size: 11.5px; line-height: 1.35; color: var(--text-3); }
@media (max-width: 900px) { .br-target-more { font-size: 12px; } }
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
.br-row.dragging { opacity: .5; }
.br-sw { width: 8px; height: 8px; }
.br-sw-rig { border-radius: 0; }
.br-n { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.br-row > .by, .br-by { font-size: 12.5px; }
.br-by { color: var(--text-3); white-space: nowrap; }
.br-tag { font-size: 11px; color: var(--text-3); white-space: nowrap; max-width: 90px; overflow: hidden; text-overflow: ellipsis; }
.br-blurb { grid-column: 2 / -1; display: none; font-size: 12px; line-height: 1.4; color: var(--text-3); padding-top: 2px; }
.br-row:hover .br-blurb, .br-row.on .br-blurb { display: block; }
.br-none { display: grid; gap: 10px; padding: 10px 14px 12px 20px; color: var(--text-2); font-size: 12.5px; line-height: 1.5; }
.br-miss b { color: var(--text); font-weight: 600; }
.br-ask { justify-self: start; }
.br-ask svg { color: var(--agent); }
.br-search kbd { flex: none; }
`;
