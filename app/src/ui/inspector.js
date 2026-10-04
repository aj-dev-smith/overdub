// The inspector: the details of what's selected, editable. Notes (count, range, chord, velocity, who wrote them;
// transpose and velocity), the clip (name, where, how long, who made which notes), the track (name, colour,
// instrument, level, pan, input), or the song when nothing is selected. Every edit is an op from 'you'; dragging a
// slider is one undo step. Fields being typed in are never overwritten by a refresh.

import { h, css, icon, fmtDb, byline } from './dom.js';
import { authorKind, authorName, authorVar } from './rack.js';
import { MOD } from './arrange-kit.js';
import { TRACK_COLORS } from '../core/project.js';
import { runTransform } from '../core/transforms.js';

export default function (app) {
  const { store, ui, music, devices } = app;
  css('ew-inspector', INSPECTOR_CSS);

  ui.panel({
    id: 'inspector', region: 'left', title: 'Inspector', icon: 'gear', order: 20,
    mount(el) {
      const root = h('div.in');
      el.append(root);
      let sig = '';
      let fields = []; // { input, read(), fmt?(v) } refreshed in place

      root.addEventListener('pointerdown', () => { ui.state.focus = 'inspector'; }, true);

      const sel = () => ui.state.selection;
      const clipRef = () => { const s = sel(); return s.clip ? store.findClip(s.clip) : null; };
      const trackOf = () => { const s = sel(); if (s.track === 'master') return null; const c = clipRef(); return c ? c.track : s.track ? store.track(s.track) : null; };
      const selNotes = () => { const c = clipRef(); const ids = sel().notes; if (!c || c.clip.kind !== 'notes' || !ids?.size) return []; return c.clip.notes.filter((n) => ids.has(n.id)); };
      const signature = () => {
        const s = sel(), c = clipRef(), t = trackOf();
        return [s.track, s.clip, c ? c.clip.kind : '', t?.id || '', t?.kind || '', s.notes?.size || 0, [...(s.notes || [])].slice(0, 50).join(','), store.get().tracks.length, s.track === 'master' ? 'm' : ''].join('|');
      };

      /* ---------------------------------------------------- field builders */
      function text(label, read, commit, opts = {}) {
        const input = h('input.ew-input.in-in', { value: read(), 'aria-label': label, spellcheck: false, ...opts });
        const done = () => { const v = input.value.trim(); if (v !== String(read())) commit(v); };
        input.addEventListener('change', done);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { input.blur(); } else if (e.key === 'Escape') { input.value = read(); input.blur(); } e.stopPropagation(); });
        fields.push({ input, read });
        return row(label, input);
      }
      function num(label, read, commit, { step = 1, min, max, unit = '' } = {}) {
        const input = h('input.ew-input.in-in.in-num', { type: 'number', step, min, max, value: read(), 'aria-label': label });
        input.addEventListener('change', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) commit(v); else input.value = read(); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); });
        fields.push({ input, read });
        return row(label, h('div.in-unit', input, unit ? h('span', unit) : null));
      }
      function slider(label, read, onInput, { min, max, step, fmt, coalesce } = {}) {
        const out = h('output.in-out.ew-mono');
        const input = h('input.in-range', { type: 'range', min, max, step, value: read(), 'aria-label': label });
        const show = () => { out.textContent = fmt(+input.value); };
        input.addEventListener('input', () => { show(); onInput(+input.value, coalesce); });
        input.addEventListener('dblclick', () => { const d = (min + max) / 2; input.value = String(label === 'Level' ? 0 : d); show(); onInput(+input.value, coalesce); });
        fields.push({ input, read, after: show });
        show();
        return row(label, h('div.in-slide', input, out));
      }
      function row(label, ...kids) { return h('div.in-row', h('label.in-l', label), h('div.in-v', ...kids)); }
      function sect(title, sub, ...kids) { return h('section.in-sec', h('header.in-h', h('b', title), sub ? h('span', sub) : null), ...kids); }
      // who made it: a byline in their ink; the house is unsigned (a dash)
      function badge(by) { return byline(by, { app, name: authorName(app, by) }) || h('span.in-house', '—'); }
      function shares(notes) {
        const n = { human: 0, agent: 0, house: 0 };
        const who = new Map();
        for (const x of notes) { const k = authorKind(app, x.by); n[k]++; who.set(x.by, (who.get(x.by) || 0) + 1); }
        const total = notes.length || 1;
        const bar = h('div.in-share', ['human', 'agent', 'house'].filter((k) => n[k]).map((k) => h('i', { style: { flex: String(n[k]), background: authorVar(k) }, title: `${k}: ${n[k]}` })));
        const legend = h('div.in-legend', [...who.entries()].sort((a, b) => b[1] - a[1]).map(([by, c]) => h('span', h('i', { style: { background: authorVar(authorKind(app, by)) } }), `${authorName(app, by)} ${Math.round((c / total) * 100)}%`)));
        return h('div.in-shares', bar, legend);
      }
      const dispatch = (ops, label, coalesce) => { const r = store.dispatch(ops, { by: 'you', label, coalesce }); if (!r.ok) ui.toast(r.error, { kind: 'bad' }); return r; };

      /* ---------------------------------------------------- sections */
      function notesSection(c, notes) {
        const ps = notes.map((n) => n.p);
        const lo = Math.min(...ps), hi = Math.max(...ps);
        const vs = notes.map((n) => n.v ?? 0.8);
        const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
        // the chord: what sounds at the first onset, or the whole selection if it's one block
        const t0 = Math.min(...notes.map((n) => n.t));
        const together = notes.filter((n) => n.t < t0 + 0.05);
        const chord = music.chordName(together.length > 1 ? together.map((n) => n.p) : ps, store.get().key);
        const key = store.get().key;
        const outKey = key ? notes.filter((n) => !music.inScale(n.p, key)).length : 0;
        const trans = (d) => dispatch({ type: 'notes.set', track: c.track.id, clip: c.clip.id, notes: notes.map((n) => ({ id: n.id, p: Math.max(0, Math.min(127, n.p + d)) })) }, `transpose ${d > 0 ? '+' : ''}${d}`);
        const drums = devices.getDevice(c.track.instrument?.device)?.cat === 'drums' || /drum/i.test(c.track.instrument?.device || '');
        const kn = drums ? music.kitNotes?.(devices.getDevice(c.track.instrument?.device) || { id: c.track.instrument?.device }) : null;
        const hits = drums ? [...new Set(ps)].sort((a, b) => a - b).map((x) => music.drumName?.(x, kn) || music.noteName(x)) : [];
        return sect('Notes', `${notes.length} selected`,
          h('div.in-facts',
            drums ? fact('Hits', hits.slice(0, 3).join(', ') + (hits.length > 3 ? ` +${hits.length - 3}` : ''), `${hits.length} sound${hits.length === 1 ? '' : 's'}`)
              : fact('Range', lo === hi ? music.noteName(lo) : `${music.noteName(lo)}–${music.noteName(hi)}`),
            drums ? null : fact('Chord', chord || '—'),
            fact('Velocity', vs.length > 1 ? `${Math.round(Math.min(...vs) * 127)}–${Math.round(Math.max(...vs) * 127)}` : String(Math.round(vs[0] * 127)), `avg ${Math.round(avg * 127)}`),
            key ? fact('In key', outKey ? `${notes.length - outKey}/${notes.length}` : 'all', music.keyLabel(key)) : null),
          slider('Velocity', () => avg, (v, co) => {
            const cur = selNotes(); const a = cur.reduce((s, n) => s + (n.v ?? 0.8), 0) / (cur.length || 1);
            const k = a > 0 ? v / a : 1;
            dispatch({ type: 'notes.set', track: c.track.id, clip: c.clip.id, notes: cur.map((n) => ({ id: n.id, v: Math.max(0.02, Math.min(1, (n.v ?? 0.8) * k)) })) }, 'velocity', co);
          }, { min: 0.02, max: 1, step: 0.01, fmt: (v) => String(Math.round(v * 127)), coalesce: 'notes:' + c.clip.id + ':vel' }),
          row('Transpose', h('div.in-btns', [[-12, '−12'], [-1, '−1'], [1, '+1'], [12, '+12']].map(([d, l]) => h('button.ew-btn.ew-btn-small', { onclick: () => trans(d), title: `Transpose ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} semitone${Math.abs(d) > 1 ? 's' : ''}` }, l)))),
          // the two most-used transforms (the piano roll's Transform menu has them all); one undo step each
          row('Shape', h('div.in-btns.in-tx', (drums ? [['humanize', 'Humanize'], ['staccato', 'Staccato']] : [['humanize', 'Humanize'], ['legato', 'Legato']]).map(([name, l]) => h('button.ew-btn.ew-btn-small', {
            'data-transform': name, title: name === 'humanize' ? 'Loosen timing and velocity a little, like a player' : name === 'legato' ? 'Stretch each note to the next one' : 'Shorten each note to half its length',
            onclick: () => {
              ui.state.trSeed = (ui.state.trSeed || 0) + 1;
              const r = runTransform(store, { track: c.track.id, clip: c.clip.id, ids: selNotes().map((n) => n.id), name, params: name === 'humanize' ? { seed: ui.state.trSeed } : {}, by: 'you', drums });
              ui.toast(r.ok ? `${r.summary[0].toUpperCase()}${r.summary.slice(1)}.` : `${r.error[0].toUpperCase()}${r.error.slice(1)}.`, r.ok || r.nothing ? {} : { kind: 'bad' });
            },
          }, l)))),
          row('Written by', shares(notes)));
      }
      function fact(k, v, sub) { return h('div.in-fact', h('small', k), h('b', v), sub ? h('span', sub) : null); }

      function clipSection(c) {
        const { track: t, clip } = c;
        const meter = store.get().meter;
        const bpb = music.beatsPerBar(meter);
        const kids = [
          text('Name', () => clip.name || '', (v) => dispatch({ type: 'clip.set', track: t.id, clip: clip.id, patch: { name: v || null } }, 'rename clip')),
          num('Start', () => +store.clip(t.id, clip.id)?.start.toFixed(3), (v) => dispatch({ type: 'clip.move', track: t.id, clip: clip.id, start: Math.max(0, v) }, 'move clip'), { step: 0.25, min: 0, unit: 'beats' }),
          num('Length', () => +store.clip(t.id, clip.id)?.length.toFixed(3), (v) => dispatch({ type: 'clip.set', track: t.id, clip: clip.id, patch: { length: Math.max(0.25, v) } }, 'clip length'), { step: 0.25, min: 0.25, unit: 'beats' }),
        ];
        const facts = [fact('At', music.posLabel(clip.start, meter)), fact('Bars', String(+(clip.length / bpb).toFixed(2))), fact('Made by', badge(clip.by))];
        if (clip.kind === 'notes') {
          facts.splice(2, 0, fact('Notes', String(clip.notes.length)));
          kids.push(h('div.in-facts', facts));
          if (clip.notes.length) kids.push(row('Notes by', shares(clip.notes)));
        } else {
          const a = store.get().assets?.[clip.asset];
          kids.push(h('div.in-facts', facts, fact('Audio', a?.name || clip.asset, a ? `${a.duration?.toFixed?.(1) ?? '?'} s · ${a.channels === 1 ? 'mono' : 'stereo'}` : '')));
          kids.push(num('Offset', () => +(store.clip(t.id, clip.id)?.offset || 0).toFixed(3), (v) => dispatch({ type: 'clip.set', track: t.id, clip: clip.id, patch: { offset: Math.max(0, v) } }, 'clip offset'), { step: 0.01, min: 0, unit: 's' }));
          kids.push(num('Gain', () => +(store.clip(t.id, clip.id)?.gain || 0).toFixed(1), (v) => dispatch({ type: 'clip.set', track: t.id, clip: clip.id, patch: { gain: v } }, 'clip gain'), { step: 0.5, unit: 'dB' }));
        }
        // the same as the clip menu's, as buttons (no right-click or long press needed)
        if (app.arranger?.duplicateClip) kids.push(row('Clip', h('div.in-btns',
          h('button.ew-btn.ew-btn-small', { 'data-act': 'clip-dup', title: 'Duplicate it right after itself', onclick: () => app.arranger.duplicateClip(clip.id) }, icon('copy', { size: 13 }), 'Duplicate'),
          h('button.ew-btn.ew-btn-small.in-danger', { 'data-act': 'clip-del', title: 'Delete this clip (Undo brings it back)', onclick: () => app.arranger.deleteClip(clip.id) }, icon('trash', { size: 13 }), 'Delete'))));
        // repeat and split (core/arrangement.js), as the clip menu has them
        if (app.arranger?.repeatClip) kids.push(row('Arrange', h('div.in-btns',
          h('button.ew-btn.ew-btn-small', { 'data-act': 'clip-repeat', title: 'Play it twice: a copy right after it', onclick: () => app.arranger.repeatClip(clip.id, 2) }, 'Repeat ×2'),
          h('button.ew-btn.ew-btn-small', { 'data-act': 'clip-split', title: `Split it in two at the playhead (${MOD}E)`, onclick: () => app.arranger.splitClip(clip.id) }, 'Split at playhead'))));
        return sect('Clip', clip.kind === 'audio' ? 'audio' : `on ${t.name}`, ...kids);
      }

      function trackSection(t) {
        const insts = devices.listDevices({ kind: 'instrument' });
        const kids = [
          text('Name', () => store.track(t.id)?.name || '', (v) => v && dispatch({ type: 'track.set', track: t.id, patch: { name: v } }, 'rename track')),
          row('Colour', h('div.in-colors', TRACK_COLORS.map((c, i) => h('button.in-color' + (t.color === c ? '.on' : ''), { style: { background: c }, title: `Colour ${i + 1}`, 'aria-label': `Colour ${i + 1}`, onclick: () => dispatch({ type: 'track.set', track: t.id, patch: { color: c } }, 'track colour') })))),
        ];
        if (t.kind === 'instrument') {
          const cur = t.instrument?.device;
          const opts = insts.some((d) => d.id === cur) ? insts : [{ id: cur, name: cur }, ...insts];
          const select = h('select.ew-input.in-in', { 'aria-label': 'Instrument', onchange: (e) => dispatch({ type: 'instrument.set', track: t.id, device: e.target.value }, 'instrument') }, opts.map((d) => h('option', { value: d.id, selected: d.id === cur }, d.name)));
          kids.push(row('Instrument', h('div.in-pair', select, h('button.ew-iconbtn', { title: 'Open its face (Devices)', onclick: () => { ui.select({ track: t.id }); ui.show('rack'); } }, icon('knob', { size: 16 })))));
        } else {
          const inp = t.input || { device: 'default', channel: 1 };
          const devSel = h('select.ew-input.in-in', { 'aria-label': 'Input device', onchange: (e) => dispatch({ type: 'track.set', track: t.id, patch: { input: { ...(store.track(t.id).input || {}), device: e.target.value } } }, 'input') }, h('option', { value: 'default' }, 'Default input'));
          if (inp.device !== 'default') devSel.append(h('option', { value: inp.device, selected: true }, inp.device));
          navigator.mediaDevices?.enumerateDevices?.().then((ds) => {
            for (const d of ds.filter((x) => x.kind === 'audioinput' && x.deviceId && x.deviceId !== 'default')) {
              if ([...devSel.options].some((o) => o.value === d.deviceId)) continue;
              devSel.append(h('option', { value: d.deviceId, selected: d.deviceId === inp.device }, d.label || 'Input ' + (devSel.options.length)));
            }
          }).catch(() => {});
          const ch = h('select.ew-input.in-in.in-ch', { 'aria-label': 'Input channel', onchange: (e) => dispatch({ type: 'track.set', track: t.id, patch: { input: { ...(store.track(t.id).input || {}), channel: +e.target.value } } }, 'input channel') },
            [1, 2, 3, 4, 5, 6, 7, 8].map((n) => h('option', { value: n, selected: n === +inp.channel }, 'ch ' + n)));
          kids.push(row('Input', h('div.in-pair.in-input', devSel, ch)));
        }
        kids.push(
          slider('Level', () => store.track(t.id)?.gain ?? 0, (v, co) => dispatch({ type: 'track.set', track: t.id, patch: { gain: v <= -59.5 ? -96 : v } }, 'level', co), { min: -60, max: 6, step: 0.5, fmt: (v) => (v <= -59.5 ? '−∞' : fmtDb(v)) + ' dB', coalesce: 'track:' + t.id + ':gain' }),
          slider('Pan', () => store.track(t.id)?.pan ?? 0, (v, co) => dispatch({ type: 'track.set', track: t.id, patch: { pan: v } }, 'pan', co), { min: -1, max: 1, step: 0.01, fmt: (v) => (Math.abs(v) < 0.005 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)), coalesce: 'track:' + t.id + ':pan' }),
          h('div.in-facts',
            fact('Kind', t.kind === 'audio' ? 'Audio' : 'Instrument'),
            fact('Clips', String(t.clips.length)),
            fact('Effects', String(t.inserts.length)),
            fact('Shaped by', badge(t.by))));
        const notes = t.clips.flatMap((c) => c.notes || []);
        if (notes.length) kids.push(row('Notes by', shares(notes)));
        if (app.arranger?.duplicateTrack) kids.push(row('Track', h('div.in-btns',
          h('button.ew-btn.ew-btn-small', { 'data-act': 'track-dup', title: 'Duplicate the track, its clips and devices', onclick: () => app.arranger.duplicateTrack(t.id) }, icon('copy', { size: 13 }), 'Duplicate'),
          h('button.ew-btn.ew-btn-small.in-danger', { 'data-act': 'track-del', title: 'Delete the track (Undo brings it back)', onclick: () => app.arranger.deleteTrack(t.id) }, icon('trash', { size: 13 }), 'Delete'))));
        const heldI = t.kind === 'audio' ? null : devices.heldDevice?.(t.instrument?.device);   // (kept off: its code hasn't run here)
        return sect('Track', t.kind === 'audio' ? 'audio' : heldI ? `${heldI.name}, kept off` : (devices.getDevice(t.instrument?.device)?.name || t.instrument?.device || ''), ...kids);
      }

      function songSection() {
        const p = store.get();
        const roots = music.NAMES;
        const scales = Object.keys(music.SCALES);
        const all = p.tracks.flatMap((t) => t.clips.flatMap((c) => c.notes || []));
        const kids = [
          text('Title', () => store.get().title, (v) => v && dispatch({ type: 'project.set', patch: { title: v } }, 'title')),
          num('Tempo', () => store.get().tempo, (v) => dispatch({ type: 'project.set', patch: { tempo: Math.max(20, Math.min(400, v)) } }, 'tempo'), { step: 1, min: 20, max: 400, unit: 'bpm' }),
          row('Key', h('div.in-pair',
            h('select.ew-input.in-in', { 'aria-label': 'Key root', onchange: (e) => dispatch({ type: 'project.set', patch: { key: e.target.value === '-' ? null : { root: e.target.value, scale: store.get().key?.scale || 'minor' } } }, 'key') },
              // a root spelled with a flat (a MIDI file's key signature: Bb, Eb) is the same key as its sharp: it's
              // matched by pitch class and shown as the song spells it
              h('option', { value: '-', selected: !p.key }, 'None'), roots.map((r) => { const on = !!p.key && music.parsePc(p.key.root) === music.parsePc(r); return h('option', { value: r, selected: on }, on ? p.key.root : r); })),
            h('select.ew-input.in-in', { 'aria-label': 'Scale', disabled: !p.key, onchange: (e) => dispatch({ type: 'project.set', patch: { key: { root: store.get().key?.root || 'C', scale: e.target.value } } }, 'scale') },
              scales.map((s) => h('option', { value: s, selected: p.key?.scale === s }, s.replace(/([A-Z])/g, ' $1').toLowerCase()))))),
          row('Meter', h('select.ew-input.in-in', { 'aria-label': 'Meter', onchange: (e) => dispatch({ type: 'project.set', patch: { meter: e.target.value.split('/').map(Number) } }, 'meter') },
            ['4/4', '3/4', '6/8', '5/4', '7/8', '12/8'].map((m) => h('option', { value: m, selected: p.meter.join('/') === m }, m)))),
          h('div.in-facts', fact('Tracks', String(p.tracks.length)), fact('Notes', String(all.length)), fact('Devices written', String(Object.keys(p.devices || {}).length))),
        ];
        if (all.length) kids.push(row('Notes by', shares(all)));
        return sect('Song', '', ...kids);
      }

      function masterSection() {
        const p = store.get();
        return sect('Master', 'the mix bus', h('div.in-facts', fact('Level', fmtDb(p.master.gain) + ' dB'), fact('Effects', String(p.master.inserts.length))),
          h('button.ew-btn.ew-btn-small', { onclick: () => ui.show('rack') }, icon('knob', { size: 14 }), 'Open the master chain'));
      }

      /* ---------------------------------------------------- render */
      function build() {
        sig = signature();
        fields = [];
        const kids = [];
        const s = sel();
        const c = clipRef();
        const notes = selNotes();
        const t = trackOf();
        if (notes.length) kids.push(notesSection(c, notes));
        if (c) kids.push(clipSection(c));
        if (s.track === 'master') kids.push(masterSection());
        else if (t) kids.push(trackSection(t));
        if (!kids.length || (!c && !s.track)) kids.push(songSection());
        if (!t && !c && s.track !== 'master') kids.unshift(h('p.in-hint', 'Select a track, a clip or some notes to see and edit their details here.'));
        root.replaceChildren(...kids);
      }
      function refresh() {
        if (signature() !== sig) { build(); return; }
        for (const f of fields) {
          if (document.activeElement === f.input) continue;
          const v = f.read();
          if (String(f.input.value) !== String(v)) f.input.value = v;
          f.after && f.after();
        }
      }
      let pend = false;
      const soon = () => { if (pend) return; pend = true; queueMicrotask(() => { pend = false; if (!el.hidden) refreshOrBuild(); }); };
      // facts (counts, chords, shares) are cheap: rebuild them unless someone is typing or dragging in here
      function refreshOrBuild() { if (root.contains(document.activeElement) && document.activeElement !== document.body) refresh(); else build(); }
      const offSel = ui.on('select', soon);
      const offDev = ui.on('input:devices', soon);   // an interface plugged in: the Input list reads it (input/audioin.js)
      build();
      return {
        update() { if (!el.hidden) soon(); else sig = ''; },
        refresh() { refreshOrBuild(); },
        unmount() { offSel(); offDev(); },
      };
    },
  });
}

const INSPECTOR_CSS = `
.in { padding: 6px 0 24px; font-size: 12px; }
.in-hint { margin: 10px 14px 4px; color: var(--text-3); line-height: 1.45; }
.in-sec { padding: 12px 14px 14px; border-bottom: var(--rule); display: grid; gap: 9px; }
.in-h { display: flex; align-items: baseline; gap: 8px; }
.in-h b { font-size: 13.5px; font-weight: 600; }
.in-h span { color: var(--text-3); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.in-row { display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 8px; }
.in-l { color: var(--text-3); font-size: 11px; }
.in-v { min-width: 0; }
.in-in { width: 100%; height: 28px; font-size: 12px; }
select.in-in { padding: 0 6px; }
.in-num { width: 76px; font-family: var(--font-mono); }
.in-unit { display: flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 11px; }
.in-pair { display: flex; gap: 6px; align-items: center; }
.in-pair .in-ch { width: 70px; flex: none; }
/* the input and its channel sit side by side when the pane has room for the input's name, else the channel goes under
   it (beside it in a 236 px pane, the select cut "Default input" to "Defa") */
.in-input { flex-wrap: wrap; row-gap: 6px; }
.in-input > select:first-child { flex: 1 1 128px; min-width: 128px; }
.in-row:has(.in-input) { align-items: start; }
.in-row:has(.in-input) > .in-l { padding-top: 8px; }
.in-slide { display: flex; align-items: center; gap: 8px; }
.in-range { flex: 1; min-width: 0; accent-color: var(--accent-2); }
.in-out { width: 52px; text-align: right; color: var(--text-2); font-size: 11px; }
.in-btns { display: flex; gap: 4px; flex-wrap: wrap; }
.in-btns .ew-btn { padding: 0 6px; min-width: 30px; justify-content: center; font-family: var(--font-mono); }
.in-btns.in-tx .ew-btn, .in-btns .ew-btn[data-act] { font-family: var(--font-ui); padding: 0 8px; }
.in-btns .in-danger { color: var(--bad); }
.in-btns .in-danger:hover { border-color: var(--bad); }
.in-colors { display: flex; gap: 5px; flex-wrap: wrap; }
.in-color { width: 18px; height: 18px; border-radius: var(--r-press); border: 0; cursor: pointer; }
.in-color.on { box-shadow: 0 0 0 2px var(--panel), 0 0 0 3.5px var(--text); }
/* facts are a spec sheet: a small pencil label over its value, no boxes */
.in-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 10px 12px; }
.in-fact { display: grid; gap: 2px; min-width: 0; }
.in-fact small { font-size: 11px; color: var(--text-3); }
.in-fact b { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.in-fact b .by { font-size: 13px; }
.in-fact span { font-size: 10px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.in-house { font-size: 11px; color: var(--text-2); }
.in-shares { display: grid; gap: 5px; }
.in-share { display: flex; height: 6px; overflow: hidden; background: var(--bg); gap: 1px; }
.in-share i { display: block; min-width: 3px; }
.in-legend { display: flex; flex-wrap: wrap; gap: 3px 10px; font-size: 10.5px; color: var(--text-2); }
.in-legend span { display: inline-flex; align-items: center; gap: 4px; }
.in-legend i { width: 7px; height: 7px; }
`;
