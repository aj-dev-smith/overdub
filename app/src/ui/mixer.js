// The mixer: a channel strip per track and the master. Name and colour, what's in the chain (click: the rack), pan,
// a fader in dB (−∞ … +6; double-click: 0 dB; one drag = one undo step), mute / solo / arm, and a meter with peak
// hold fed by engine.meters. The master strip adds a K-weighted momentary loudness (≈ LUFS, 400 ms) and a held peak,
// measured here from engine.masterTap. Whoever last shaped a track shows as the strip's bottom edge.
// Automation (docs/research/AUTOMATION.md 3.6): a fader or pan with a playing lane moves with the song and says "auto"
// beside its value; moving it holds the lane (one undo step with the move), and it says "held" (click: back to the
// lane). Right-click, a long press or the menu key on either: Automate (the lane in the arranger), Back to the lane.
// A finger (ui/touch.js, the rule every control shares): a drag on a fader or a pan knob scrolls the strips; held still
// first, it picks the control up. A swipe up or down that moved nothing says how (the strips only scroll sideways, so it
// was a reach for the control). On a touch screen the pan knob and M, S and ● are 44 px (app/style/app.css widens the
// strips to hold them).
//
// app.mixer = { dbToPos(db), posToDb(pos), loudness() -> { lufs, peak } | null }

import { h, css, icon, drag, clamp, fmtDb, canvas, tok, byline } from './dom.js';
import { miniKnob, authorKind, authorVar, authorName, pressMenu, laneFor, laneNow, laneNote, controlOps, heldNote, heldSay, backToLane, automate, controlMenu } from './rack.js';
import { songColor, MOD } from './arrange-kit.js';
import { dbToPos, posToDb } from '../core/automation.js';
import { holdToMove } from './touch.js';

// The fader law (piecewise like a console's, so 0 dB sits high and the useful range gets the travel) is
// core/automation.js's: a gain lane is drawn and played on the same travel, so a line on it is a hand on the fader.
export { dbToPos, posToDb };
const TICKS = [6, 0, -6, -12, -24, -48];
// which marks a short fader keeps first: 0 dB, the floor, the middle, then the rest
const TICK_RANK = [0, -48, -12, 6, -24, -6];
// a touch screen's narrowest strip: M, S and ● in a row at 44 px each, 2 px apart, inside the strip's 6 px edges
const STRIP_MIN = 3 * 44 + 2 * 2 + 2 * 6;
// how much of the next strip shows when only one fits: its left edge and its M, up to its S
const PEEK = 6 + 44 + 2;
// a fader's scale shows a mark only where it clears its neighbours (the law packs −12 to −48 into the bottom third)
function fitScale(s) {
  if (!s.scale) return;
  const span = s.scale.clientHeight - 14, marks = [...s.scale.children];
  if (span <= 0) return;
  const gap = (parseFloat(getComputedStyle(marks[0]).fontSize) || 9) + 3, kept = [];
  for (const d of TICK_RANK) {
    const y = dbToPos(d) * span, el = marks.find((m) => +m.dataset.db === d);
    const ok = kept.every((k) => Math.abs(k - y) >= gap);
    if (ok) kept.push(y);
    if (el) el.hidden = !ok;
  }
}
const panText = (p) => (Math.abs(p) < 0.005 ? 'C' : (p < 0 ? 'L' : 'R') + Math.round(Math.abs(p) * 100));
const roundDb = (db) => (db <= -95.9 ? -96 : Math.round(db * 10) / 10);
const coarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };
// the label a strip's M, S or ● puts in History, as the arranger's header writes it ("unmute Drums", "solo Bass")
const flagLabel = (t, k) => `${t[k] ? { mute: 'unmute', solo: 'unsolo', arm: 'disarm' }[k] : k} ${t.name}`;

export default function (app) {
  const { store, ui, engine } = app;
  css('ew-mixer', MIXER_CSS);
  let masterOp = null; // 'master.set' once the core has it (FALLBACK: the master fader is read-only until then)
  app.mixer = { dbToPos, posToDb, loudness: () => null };

  ui.panel({
    id: 'mixer', region: 'bottom', title: 'Mixer', icon: 'panelBottom', order: 30,
    mount(el) {
      const root = h('div.mx');
      const lane = h('div.mx-lane');
      root.append(lane);
      el.append(root);
      let sig = '';
      let strips = new Map(); // id -> strip
      let flashes = [];
      let colors = {};
      let lastT = performance.now();
      let loud = null; // the master loudness tap

      root.addEventListener('pointerdown', () => { ui.state.focus = 'mixer'; }, true);
      // the strips' fit (a touch screen: whole strips beside the master, or one and the next one's edge where only one
      // fits; the master over no strip's S or ●) and each fader's scale
      // (only the marks that have room at this height), measured whenever the pane changes size
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
      if (ro) ro.observe(root);
      function fit() {
        if (!root.isConnected) return;
        const ms = strips.get('master')?.el;
        if (coarse() && ms) {
          const cs = getComputedStyle(ms), mw = ms.offsetWidth + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
          const box = lane.querySelector('.mx-strips'), pl = box ? parseFloat(getComputedStyle(box).paddingLeft) || 0 : 0;
          // (room for one strip only, a 360 px phone: the next one shows its edge up to its M beside it, so the mixer
          // reads as a row to swipe, not one strip stretched across the screen; its S and ● stay clear of the master)
          const room = root.clientWidth - mw - pl, n = Math.floor(room / STRIP_MIN);
          root.style.setProperty('--mx-sw', `${n < 2 ? Math.max(STRIP_MIN, room - PEEK) : Math.floor(room / n)}px`);
        } else root.style.removeProperty('--mx-sw');
        for (const s of strips.values()) fitScale(s);
      }

      const structure = () => store.get().tracks.map((t) => [t.id, t.name, t.color, t.kind, t.by, t.inserts.length, t.instrument?.device || '', keyedBy(t)].join(':')).join('|') + '|m' + store.get().master.inserts.length;
      // "keyed by Kick": the track a keyed insert on this one (Dim Switch) listens to, in words, or ''
      function keyedBy(t) {
        const x = t && t.inserts.find((i) => i.key && i.key.track);
        if (!x) return '';
        const src = store.get().tracks.find((o) => o.id === x.key.track);
        return src ? `keyed by ${src.name}` : 'key track missing';
      }

      function build() {
        sig = structure();
        strips = new Map();
        const p = store.get();
        const kids = p.tracks.map((t) => strip(t));
        if (!p.tracks.length) kids.push(h('div.mx-empty.empty', h('p', 'No tracks yet. Every track gets a strip here, with its level, pan, mute and solo.'), h('button.btn', { onclick: () => ui.show('sketch') }, 'Open Sketch')));
        lane.replaceChildren(h('div.mx-strips', kids), strip(null));
        update();
        presence();
        fit();
      }

      function strip(t) {
        const id = t ? t.id : 'master';
        const ak = t ? authorKind(app, t.by) : 'house';
        const color = t ? songColor(t.color) : 'var(--text-2)';   // (a song's colour: a token or hex, never a url())
        const s = { id, t, el: null, hold: -120, holdAt: 0, rms: -120, peak: -120, clip: false, last: '' };
        const fxN = t ? t.inserts.length : store.get().master.inserts.length;
        const heldI = t?.instrument ? app.devices.heldDevice?.(t.instrument.device) : null;   // (kept off: its code hasn't run here)
        const inst = t?.instrument ? (heldI ? `${heldI.name}, kept off` : app.devices.getDevice(t.instrument.device)?.name || t.instrument.device) : t ? 'Audio in' : 'Mix bus';
        const head = h('button.mx-name', { title: t ? `${t.name}: select (double-click: inspect)` : 'The master', onclick: () => ui.select({ track: id, insert: null }), ondblclick: () => ui.show('inspector') },
          h('span.mx-nl', h('i.mx-chip', { style: { background: color } }), h('b', t ? t.name : 'Master')), t ? (byline(t.by, { app, title: `Last shaped by ${authorName(app, t.by)}` }) || h('span.mx-by-none')) : null);
        const fx = h('button.mx-fx', { title: 'Show the chain (Devices)', onclick: () => { ui.select({ track: id, insert: null }); ui.show('rack'); } },
          h('span', inst), h('em', fxN ? `${fxN} fx` : '+ fx'), t && keyedBy(t) ? h('small.mx-keyed', keyedBy(t)) : null);
        let pan = null, panOut = null;
        if (t) {
          panOut = h('output.mx-pan-v', panText(t.pan));
          pan = miniKnob({ value: t.pan, min: -1, max: 1, def: 0, size: coarse() ? 44 : 28, bipolar: true, label: `${t.name} pan`, title: 'Pan (double-click: centre; right-click: Automate)', fmt: panText,
            onInput: (v, commit) => { const pv = Math.round(v * 100) / 100; panOut.textContent = panText(pv); if (pv !== shownPan(id) || commit) setPan(id, pv, commit); },
            onMenu: (a) => controlMenu(app, a, { track: id, param: 'pan' }, { name: 'Pan' }) });
          pan.style.setProperty('--mk-c', color);
        }
        const btn = (k, label, tip) => h('button.mx-b.mx-' + k, { title: tip, 'aria-pressed': 'false', onclick: (e) => toggle(id, k, e) }, label);
        // the master's loudness: what the meter measures, in words (K-weighted over the last 400 ms, as a loudness meter's
        // momentary reading is; worked out here, so close to one, not certified)
        const btns = t ? h('div.mx-btns', btn('mute', 'M', 'Mute (M)'), btn('solo', 'S', 'Solo (S; Alt-click: solo only this)'), btn('arm', icon('record', { size: 11 }), 'Arm to record'))
          : h('div.mx-btns.mx-loud', { title: 'Momentary loudness: K-weighted over the last 400 ms, measured here in the browser (close to a loudness meter’s, not certified)' }, s.loudL = h('span', 'Loudness'), s.lufsEl = h('b.ew-mono', '—'), h('small', 'LUFS, momentary'));
        const cv = canvas('mx-meter');
        const thumb = h('div.mx-thumb', { role: 'slider', tabindex: 0, 'aria-label': `${t ? t.name : 'Master'} level`, 'aria-valuemin': -96, 'aria-valuemax': 6 }, h('i'));
        const scale = h('div.mx-scale', { 'aria-hidden': 'true' }, TICKS.map((d) => h('span', { dataset: { db: d }, style: { bottom: `calc(7px + ${dbToPos(d)} * (100% - 14px))` } }, d > 0 ? '+' + d : String(d))));
        const track = h('div.mx-track', h('div.mx-groove'), scale, thumb);
        const peakEl = h('button.mx-peak.ew-mono', { title: 'Peak hold (click to reset)', onclick: () => { s.hold = -120; s.clip = false; s.maxPeak = -120; } }, '—');
        const out = h('button.mx-db.ew-mono', { title: 'Level in dB (click to type; double-click the fader: 0 dB)', onclick: () => typeDb(s) }, '');
        // automation marks: "auto" / "held" beside the level and beside the pan
        const gMark = h('button.mx-am', { type: 'button', hidden: true, onclick: () => markClick(s, 'gain') });
        const pMark = t ? h('button.mx-am.mx-am-pan', { type: 'button', hidden: true, onclick: () => markClick(s, 'pan') }) : null;
        const fader = h('div.mx-fader', track, h('div.mx-mwrap', peakEl, cv.cv));
        s.el = h('div.mx-strip' + (t ? '' : '.mx-master'), { dataset: { track: id, author: ak }, style: { '--tc': color, '--ae': authorVar(ak) }, title: t ? `${t.name}, last shaped by ${authorName(app, t.by)}` : '' },
          head, fx, t ? h('div.mx-pan', pan, panOut, pMark) : null, btns, fader, h('div.mx-dbrow', out, gMark));
        Object.assign(s, { scale, thumb, track, cv, peakEl, out, pan, panOut, btns, gMark, pMark, name: t ? t.name : 'Master' });
        // a finger: a drag scrolls the strips, a hold picks the control up (a fader by its cap, so it never jumps)
        holdToMove(track, { name: 'fader', pick: () => thumb, scroller: root, heldClass: 'mx-held', hintKey: HOLD_HINT });
        if (pan) holdToMove(pan, { name: 'pan knob', scroller: root, heldClass: 'mx-held', hintKey: HOLD_HINT });
        wireFader(s);
        strips.set(id, s);
        return s.el;
      }

      // the value a control shows: its playing lane's at the playhead (stopped: the marker), else its own
      const addrOf = (id, param) => ({ track: id, param });
      function gainOf(id) { return id === 'master' ? store.get().master.gain : store.track(id)?.gain ?? 0; }
      function shownGain(id) { const v = laneNow(app, addrOf(id, 'gain')); return v == null ? gainOf(id) : Math.min(6, v); }
      // A finger on a fader or a pan knob (ui/touch.js, holdToMove above): a drag scrolls the strips (one finger always
      // does, as in the arranger, a sheet shorter than a strip down too), and the control moves only once it has been
      // held still: then it is picked up (lit, a buzz) and a drag moves it; held on, its menu opens as before. The first
      // hold says so once (this key, as it always has). A mouse is untouched.
      const HOLD_HINT = 'overdub:mixer-hold-hint';
      function shownPan(id) { const v = laneNow(app, addrOf(id, 'pan')); return v == null ? store.track(id)?.pan ?? 0 : v; }
      // a hand on the fader: the move, and (on a playing lane) holding the lane, one undo step per gesture
      function setGain(id, db, commit) {
        db = roundDb(clamp(db, -96, 6));
        const addr = addrOf(id, 'gain');
        if (id === 'master') {
          if (masterOp === false) { if (commit) ui.toast('The master level can’t be changed yet (needs the master.set op)'); return; }
          const ops = controlOps(app, addr, { type: 'master.set', patch: { gain: db } });
          const r = store.dispatch(ops, { by: 'you', coalesce: 'master:gain', label: 'master level' });
          if (!r.ok && /unknown op/.test(r.error)) { masterOp = false; strips.get('master')?.el.classList.add('mx-ro'); ui.toast('The master level can’t be changed yet (needs the master.set op)'); }
          else masterOp = true;
          if (r.ok && ops.length > 1) heldNote(app, addr, 'Master level', fmtDb(db) + ' dB', { later: !commit });
          else if (commit) heldSay(app, fmtDb(db) + ' dB');
          return;
        }
        if (db === shownGain(id) && !commit) return;
        const ops = controlOps(app, addr, { type: 'track.set', track: id, patch: { gain: db } });
        const r = store.dispatch(ops, { by: 'you', coalesce: 'track:' + id + ':gain', label: `${store.track(id)?.name} level` });
        if (r.ok && ops.length > 1) heldNote(app, addr, `${store.track(id)?.name} level`, (db <= -96 ? '−∞' : fmtDb(db)) + ' dB', { later: !commit });
        else if (commit) heldSay(app, (db <= -96 ? '−∞' : fmtDb(db)) + ' dB');
      }
      function setPan(id, pv, commit) {
        const addr = addrOf(id, 'pan');
        const ops = controlOps(app, addr, { type: 'track.set', track: id, patch: { pan: pv } });
        const r = store.dispatch(ops, { by: 'you', coalesce: 'track:' + id + ':pan', label: `${store.track(id)?.name} pan` });
        if (r.ok && ops.length > 1) heldNote(app, addr, `${store.track(id)?.name} pan`, panText(pv), { later: !commit });
        else if (commit) heldSay(app, panText(pv));
      }
      function markClick(s, param) {
        const addr = addrOf(s.id, param), name = param === 'pan' ? `${s.name} pan` : `${s.name} level`;
        const l = laneFor(app, addr);
        if (!l) return;
        if (l.held) backToLane(app, addr, name); else automate(app, addr, name);
      }
      function wireFader(s) {
        let p0 = 0, hgt = 1, g = null;
        // a finger rests still for a long press (the menu): it moves the fader (or jumps it to the groove) only once it
        // has travelled 8 px; a mouse moves it at once, as before
        const jumpTo = (y) => { const r = s.track.getBoundingClientRect(); setGain(s.id, posToDb(clamp(1 - (y - r.top - 19) / (hgt - 26), 0, 1)), false); };
        drag(s.track, {
          start: (e) => {
            hgt = s.track.clientHeight || 1;
            const onThumb = s.thumb.contains(e.target);
            g = { touch: e.pointerType === 'touch', jump: onThumb ? null : e.clientY, live: e.pointerType !== 'touch', dy: 0, moved: false };
            if (g.live && g.jump != null) jumpTo(g.jump); // jump: click on the groove moves the fader there
            p0 = dbToPos(shownGain(s.id));
            s.thumb.focus();
            s.el.classList.add('moving');
          },
          move: (e, dx, dy) => {
            if (!g) return;
            if (!g.live) {
              if (Math.hypot(dx, dy) <= 8) return;
              g.live = true; g.dy = dy;
              if (g.jump != null) { jumpTo(g.jump + dy); p0 = dbToPos(shownGain(s.id)); }
            }
            g.moved = true;
            setGain(s.id, posToDb(clamp(p0 - ((dy - g.dy) / (hgt - 26)) * (e.shiftKey ? 0.15 : 1), 0, 1)), false);
          },
          end: () => {
            s.el.classList.remove('moving');
            const was = g; g = null;
            if (was && was.touch && !was.live && was.jump != null) jumpTo(was.jump); // a tap on the groove
            if (was && (was.moved || was.jump != null)) { const g1 = shownGain(s.id); heldSay(app, (g1 <= -96 ? '−∞' : fmtDb(g1)) + ' dB'); }
          },
        });
        pressMenu(s.track, (a) => controlMenu(app, a, addrOf(s.id, 'gain'), { name: `${s.name} level` }), { onLong: () => { g = null; s.el.classList.remove('moving'); } });
        s.track.addEventListener('dblclick', () => setGain(s.id, 0, true));
        s.track.addEventListener('wheel', (e) => { e.preventDefault(); setGain(s.id, posToDb(dbToPos(shownGain(s.id)) - Math.sign(e.deltaY) * 0.02), true); }, { passive: false });
        s.thumb.addEventListener('keydown', (e) => {
          const g = shownGain(s.id), st = e.shiftKey ? 0.1 : 1;
          if (e.key === 'ArrowUp') setGain(s.id, g <= -96 ? -60 : g + st, true);
          else if (e.key === 'ArrowDown') setGain(s.id, g - st < -60 ? -96 : g - st, true);
          else if (e.key === 'Home' || e.key === '0') setGain(s.id, 0, true);
          else return;
          e.preventDefault(); e.stopPropagation();
        });
      }
      function typeDb(s) {
        const inp = h('input.mx-dbin.ew-mono', { value: shownGain(s.id) <= -96 ? '-inf' : String(roundDb(shownGain(s.id))), 'aria-label': 'Level in dB' });
        s.out.replaceWith(inp);
        inp.focus(); inp.select();
        let finished = false;
        const done = (ok) => {
          if (finished || !inp.isConnected) return;
          finished = true;
          if (ok) { const v = /inf/i.test(inp.value) ? -96 : parseFloat(inp.value.replace('−', '-')); if (Number.isFinite(v)) setGain(s.id, v, true); }
          inp.replaceWith(s.out); s.dirtyG = true; update();
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); e.stopPropagation(); });
        inp.addEventListener('blur', () => done(true));
      }
      function toggle(id, k, e) {
        const t = store.track(id);
        if (!t) return;
        if (k === 'solo' && e?.altKey) {
          const ops = store.get().tracks.filter((x) => x.solo !== (x.id === id)).map((x) => ({ type: 'track.set', track: x.id, patch: { solo: x.id === id } }));
          if (ops.length) store.dispatch(ops, { by: 'you', label: `solo only ${t.name}` });
          return;
        }
        store.dispatch({ type: 'track.set', track: id, patch: { [k]: !t[k] } }, { by: 'you', label: flagLabel(t, k) });
      }

      // values from the song (no rebuild)
      function update() {
        const p = store.get();
        const anySolo = p.tracks.some((t) => t.solo);
        for (const s of strips.values()) {
          const t = s.id === 'master' ? null : store.track(s.id);
          marks(s);
          drawGain(s, shownGain(s.id));
          s.el.classList.toggle('sel', (ui.state.selection.track || p.tracks[0]?.id) === s.id);
          if (!t) continue;
          drawPan(s, shownPan(s.id));
          for (const k of ['mute', 'solo', 'arm']) { const b = s.btns.querySelector('.mx-' + k); b.classList.toggle('on', !!t[k]); b.setAttribute('aria-pressed', String(!!t[k])); }
          s.el.classList.toggle('quiet', t.mute || (anySolo && !t.solo));
        }
      }

      function drawGain(s, g) {
        if (s.shownG === g && !s.dirtyG) return;
        s.shownG = g; s.dirtyG = false;
        s.thumb.style.bottom = `calc(${dbToPos(g)} * (100% - 26px))`;
        s.thumb.setAttribute('aria-valuenow', g);
        const a = s.gMark && !s.gMark.hidden ? s.gMark.dataset.mark : '';
        s.thumb.setAttribute('aria-valuetext', fmtDb(g) + ' dB' + (a === 'auto' ? ', follows its lane' : a === 'held' ? ', held' : ''));
        // (with a mark beside it the unit goes, so the number and the word fit the strip)
        if (s.out.isConnected) s.out.textContent = (g <= -96 ? '−∞' : fmtDb(g)) + (a ? '' : ' dB');
      }
      function drawPan(s, v) {
        if (!s.pan || s.pan.classList.contains('turning')) return;
        if (s.shownP === v) return;
        s.shownP = v;
        s.pan.set(v); s.panOut.textContent = panText(v);
      }
      // "auto" (the lane plays: click shows it) or "held" (click: back to the lane) beside the level and the pan
      function marks(s) {
        s.follow = [];
        for (const [param, el] of [['gain', s.gMark], ['pan', s.pMark]]) {
          if (!el) continue;
          const addr = addrOf(s.id, param), l = laneFor(app, addr);
          const name = param === 'pan' ? `${s.name} pan` : `${s.name} level`;
          const state = l ? (l.held ? 'held' : 'auto') : '';
          if (el.dataset.mark !== state) s.dirtyG = true;
          el.hidden = !state;
          el.dataset.mark = state;
          el.textContent = state;
          el.title = !l ? '' : l.held ? `${laneNote(app, addr, name)}. Click: back to the lane` : `${laneNote(app, addr, name)}. Click: show the lane`;
          el.setAttribute('aria-label', !l ? '' : l.held ? `${name} is held: back to the lane` : `${name} follows its lane: show it`);
          if (l && !l.held) s.follow.push(param);
          if (param === 'pan' && s.pan) s.pan.title = l ? `${laneNote(app, addr, name)}. Pan (double-click: centre; right-click: Automate)` : 'Pan (double-click: centre; right-click: Automate)';
        }
        s.shownP = null;
      }
      // while playing (and on a seek), the controls on playing lanes move with the song
      function follow() {
        for (const s of strips.values()) {
          if (!s.follow?.length) continue;
          if (s.follow.includes('gain') && !s.el.classList.contains('moving')) drawGain(s, shownGain(s.id));
          if (s.follow.includes('pan')) drawPan(s, shownPan(s.id));
        }
      }

      /* ---------------------------------------------------- agents */
      function flash(id) { const s = strips.get(id); if (!s) return; s.el.classList.remove('ew-agent-flash'); void s.el.offsetWidth; s.el.classList.add('ew-agent-flash'); flashes.push({ el: s.el, until: performance.now() + 1500 }); }
      function presence() {
        for (const s of strips.values()) { s.el.classList.remove('ew-presence'); s.el.querySelector('.mx-pres')?.remove(); }
        for (const pr of ui.state.presence || []) {
          if (!pr.track || pr.clip || pr.notes || pr.insert) continue;
          const s = strips.get(pr.track);
          if (!s) continue;
          s.el.classList.add('ew-presence');
          s.el.append(h('div.crop.mx-pres', { title: pr.note || '' }, h('i'), h('i'), h('i'), h('i'), h('span', authorName(app, pr.by))));
        }
      }
      const offPres = ui.on('presence', presence);
      const offSel = ui.on('select', () => update());

      /* ---------------------------------------------------- the master's loudness (K-weighted, 400 ms, ≈ BS.1770 M) */
      function ensureLoud() {
        if (loud || !engine.ctx || engine.ctx.state !== 'running' || !engine.masterTap) return loud;
        try {
          const c = engine.ctx;
          const split = c.createChannelSplitter(2);
          const chans = [0, 1].map((i) => {
            const shelf = c.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1681; shelf.gain.value = 4;
            const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
            const an = c.createAnalyser(); an.fftSize = 2048;
            split.connect(shelf, i); shelf.connect(hp); hp.connect(an);
            return { an, buf: new Float32Array(an.fftSize) };
          });
          const raw = c.createAnalyser(); raw.fftSize = 2048;
          engine.masterTap.connect(split); engine.masterTap.connect(raw);
          loud = { chans, raw, rbuf: new Float32Array(2048), ms: 0, lufs: -Infinity, peak: -120, held: -120, tap: engine.masterTap };
        } catch (e) { console.warn('mixer: no loudness tap', e.message); loud = null; }
        return loud;
      }
      function readLoud(dt) {
        const L = ensureLoud();
        if (!L) return null;
        if (L.tap !== engine.masterTap) { loud = null; return null; } // the engine rebuilt its master
        let sum = 0;
        for (const ch of L.chans) { ch.an.getFloatTimeDomainData(ch.buf); let s = 0; for (let i = 0; i < ch.buf.length; i++) s += ch.buf[i] * ch.buf[i]; sum += s / ch.buf.length; }
        const a = 1 - Math.exp(-dt / 0.4);
        L.ms += (sum - L.ms) * a;
        L.lufs = L.ms > 1e-10 ? -0.691 + 10 * Math.log10(L.ms) : -Infinity;
        L.raw.getFloatTimeDomainData(L.rbuf);
        let pk = 0;
        for (let i = 0; i < L.rbuf.length; i++) { const x = Math.abs(L.rbuf[i]); if (x > pk) pk = x; }
        L.peak = pk > 0 ? 20 * Math.log10(pk) : -120;
        return L;
      }

      /* ---------------------------------------------------- meters */
      function drawMeter(s, now, lv) {
        const { g } = s.cv;
        const resized = s.cv.fit();
        const W = s.cv.w, H = s.cv.h;
        const dt = Math.min(0.1, (now - (s.t || now)) / 1000); s.t = now;
        const pk = lv ? lv.peak : -120, rm = lv ? lv.rms : -120;
        s.peak = pk > s.peak ? pk : Math.max(pk, s.peak - 26 * dt);
        s.rms = rm > s.rms ? s.rms + (rm - s.rms) * 0.6 : Math.max(rm, s.rms - 18 * dt);
        if (pk >= s.hold) { s.hold = pk; s.holdAt = now; } else if (now - s.holdAt > 1400) s.hold = Math.max(-120, s.hold - 20 * dt);
        if (pk > -0.05) s.clip = true;
        s.maxPeak = Math.max(s.maxPeak ?? -120, pk);
        const key = `${W}|${H}|${s.peak.toFixed(1)}|${s.rms.toFixed(1)}|${s.hold.toFixed(1)}|${s.clip}`;
        if (key === s.last && !resized) return;
        s.last = key;
        g.clearRect(0, 0, W, H);
        const top = 7, hh = H - 14;
        const y = (db) => top + hh * (1 - dbToPos(db));
        g.fillStyle = colors.slot; g.fillRect(0, top, W, hh);
        const grad = g.createLinearGradient(0, y(-96), 0, y(6));
        grad.addColorStop(0, colors.low); grad.addColorStop(dbToPos(-12), colors.low); grad.addColorStop(dbToPos(-4), colors.warn); grad.addColorStop(dbToPos(0), colors.bad); grad.addColorStop(1, colors.bad);
        if (s.peak > -96) { g.globalAlpha = 0.45; g.fillStyle = grad; g.fillRect(0, y(s.peak), W, y(-96) - y(s.peak)); }
        if (s.rms > -96) { g.globalAlpha = 1; g.fillStyle = grad; g.fillRect(0, y(s.rms), W, y(-96) - y(s.rms)); }
        g.globalAlpha = 1;
        for (const d of TICKS) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, Math.round(y(d)), W, 1); }
        if (s.hold > -90) { g.fillStyle = s.hold > -0.05 ? colors.bad : colors.text; g.fillRect(0, Math.round(y(s.hold)) - 1, W, 2); }
        g.fillStyle = s.clip ? colors.bad : colors.slot; g.fillRect(0, 0, W, 3);
        const ph = s.id === 'master' && loud ? Math.max(s.maxPeak, loud.held) : s.hold;
        s.peakEl.textContent = ph > -90 ? (ph > 0 ? '+' : '') + ph.toFixed(1) : '—';
        s.peakEl.classList.toggle('hot', ph > -0.3);
      }

      function readColors() { colors = { slot: 'rgba(10, 9, 7,.7)', low: tok('--ok') || '#8fe3a1', warn: tok('--warn') || '#ffd166', bad: tok('--bad') || '#ff6b81', text: tok('--text') || '#fff' }; }
      readColors();
      build();

      app.mixer.loudness = () => (loud ? { lufs: loud.lufs, peak: loud.held } : null);

      return {
        update(evt) {
          if (structure() !== sig || evt.kind === 'load') build(); else update();
          if (evt.kind === 'do' && store.isAgent(evt.by)) {
            for (const op of evt.ops || []) if (op.type === 'track.set' && op.track) flash(store.track(op.track)?.id || [...store.get().tracks].find((t) => t.name.toLowerCase() === String(op.track).toLowerCase())?.id);
          }
        },
        refresh() { if (structure() !== sig) build(); else update(); },
        frame(now) {
          const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
          if (flashes.length) flashes = flashes.filter((f) => { if (now > f.until) { f.el.classList.remove('ew-agent-flash'); return false; } return true; });
          const m = engine.meters || { tracks: {}, master: null };
          const running = !!engine.ctx && engine.ctx.state === 'running';
          const L = running ? readLoud(dt) : null;
          if (L) {
            L.held = Math.max(L.held, L.peak);
            const ms = strips.get('master');
            if (ms?.lufsEl) { const v = Number.isFinite(L.lufs) && L.lufs > -70 ? L.lufs.toFixed(1) : '—'; if (ms.lufsEl.textContent !== v) ms.lufsEl.textContent = v; }
          }
          for (const s of strips.values()) drawMeter(s, now, running ? (s.id === 'master' ? m.master : m.tracks?.[s.id]) : null);
          // (the meter's fix, fresh eyes 6, the producer's Broken 2: the master's meter reads the mix before the safety
          // clip now, engine/strip.js. Past 0 dBFS its label says by how much, as the top bar does: app.transport.over)
          const mst = strips.get('master'), ov = running ? +app.transport?.over || 0 : 0, lt = ov > 0 ? `Clipping ${ov.toFixed(1)} dB` : 'Loudness';
          if (mst?.loudL && mst.loudL.textContent !== lt) { mst.loudL.textContent = lt; mst.loudL.classList.toggle('mx-over', ov > 0); }
          follow();
        },
        unmount() { offPres(); offSel(); ro?.disconnect(); },
      };
    },
  });

  // M mutes and S solos the selected track, everywhere in the studio, as in Logic and GarageBand (until 2 October 2026
  // M was the click and S split a clip, except in the mixer). The selected track is the one selected, else the selected
  // clip's; with neither they say so and do nothing. History says which way it went ("unmute Drums", not "track
  // mute"). While musical typing has the home row, S is its note (the shell tries a mode's keys first); M isn't one.
  const selTrack = () => {
    const s = ui.state.selection, t = s.track && s.track !== 'master' ? store.track(s.track) : null;
    return t || (s.clip ? store.findClip?.(s.clip)?.track || null : null);
  };
  const MOVED = { mute: '`M` mutes now, as in Logic and GarageBand; the click is `K`.', solo: `\`S\` solos now, as in Logic and GarageBand; \`${MOD}E\` splits.` };
  function flagKey(k) {
    const t = selTrack(), first = ui.keys.firstPress?.(k === 'mute' ? 'KeyM' : 'KeyS');
    const note = first ? ' ' + (ui.keys.movedNote || MOVED[k]) : '';
    if (!t) { ui.toast(`${ui.state.selection.track === 'master' ? `The master has no ${k}. ` : ''}Select a track to ${k} it.${note}`, { ms: first ? 6000 : 2400 }); return; }
    const on = !t[k];
    const r = store.dispatch({ type: 'track.set', track: t.id, patch: { [k]: on } }, { by: 'you', label: flagLabel(t, k) });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return; }
    const did = `${{ mute: on ? 'Muted' : 'Unmuted', solo: on ? 'Soloed' : 'Unsoloed' }[k]} ${t.name}.`;
    if (first) ui.toast(did + note, { ms: 6000 });
    else ui.announce?.(did);
  }
  ui.keys.add({ key: 'KeyM', run: () => flagKey('mute'), label: 'Mute or unmute the selected track', group: 'Track' });
  ui.keys.add({ key: 'KeyS', run: () => flagKey('solo'), label: 'Solo or unsolo the selected track', group: 'Track' });

}

const MIXER_CSS = `
.mx { height: 100%; overflow: auto hidden; background: var(--bg); }
.mx-lane { display: flex; height: 100%; min-width: max-content; width: 100%; }
.mx-lane > .mx-master { margin-left: auto; }
.mx-strips { display: flex; gap: 0; padding: 10px 0 8px 8px; height: 100%; }
.mx-empty { align-self: center; width: 300px; }
/* a strip is a column between hairlines, not a card; the selected one's name is reverse print */
.mx-strip { position: relative; display: flex; flex-direction: column; gap: 6px; width: 84px; height: 100%; padding: 0 8px 7px; border-right: var(--rule); }
.mx-strip.sel { background: var(--bg-2); }
.mx-strip.quiet .mx-meter, .mx-strip.quiet .mx-name b { opacity: .45; }
.mx-name { display: flex; flex-direction: column; align-items: stretch; gap: 5px; padding: 0 0 2px; border: 0; background: none; color: var(--text); cursor: pointer; text-align: left; min-width: 0; }
.mx-name { gap: 2px; }
.mx-nl { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 2px 3px; margin: 0 -3px; }
.mx-chip { flex: none; width: 8px; height: 8px; }
.mx-name b { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mx-name .by, .mx-by-none { font-size: 12px; min-height: 14px; overflow: hidden; text-overflow: ellipsis; }
.mx-strip.sel .mx-nl { background: var(--text); color: var(--bg); }
.mx-fx { display: grid; gap: 1px; padding: 3px 0 4px; border: 0; border-top: var(--rule); border-bottom: var(--rule); background: none; color: var(--text-3); cursor: pointer; text-align: left; font-size: 10px; min-width: 0; }
.mx-fx span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); }
.mx-fx em { font-style: normal; font-family: var(--font-mono); }
.mx-fx .mx-keyed { font-size: 10px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mx-fx:hover { border-color: var(--line-2); color: var(--text); }
.mx-pan { display: flex; align-items: center; justify-content: center; gap: 4px; }
.mx-pan-v { width: 28px; font: 600 10px var(--font-mono); color: var(--text-3); text-align: left; }
.mx-btns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; }
.mx-b { display: grid; place-items: center; height: 20px; padding: 0; border-radius: var(--r-press); border: 1px solid var(--line-2); background: var(--bg); color: var(--text-3); cursor: pointer; font: 700 10px var(--font-mono); }
.mx-b:hover { color: var(--text); }
.mx-mute.on { background: var(--warn); border-color: var(--warn); color: #241a00; }
.mx-solo.on { background: var(--accent-2); border-color: var(--accent-2); color: #2a1d00; }
.mx-arm.on { background: var(--rec); border-color: var(--rec); color: #fff; }
.mx-loud { grid-template-columns: 1fr; gap: 0; text-align: center; padding: 3px 0; border-top: var(--rule); border-bottom: var(--rule); }
.mx-loud span { font-size: 10.5px; color: var(--text-3); }
.mx-loud .mx-over { color: var(--bad); white-space: nowrap; }
.mx-loud b { font-size: 15px; color: var(--text); }
.mx-loud small { font-size: 9px; color: var(--text-3); }
.mx-fader { flex: 1; min-height: 60px; display: grid; grid-template-columns: 1fr 12px; gap: 6px; }
.mx-track { position: relative; cursor: ns-resize; touch-action: none; }
.mx-groove { position: absolute; left: calc(var(--mx-sl) + 15px); top: 19px; bottom: 7px; width: 4px; margin-left: -2px; border-radius: 3px; background: #13110e; box-shadow: inset 0 1px 2px #000, 0 1px 0 rgba(255,255,255,.05); }
/* the scale is a column of its own left of the cap (--mx-sl wide, the marks set flush right against the groove's side),
   so a mark never sits under the cap; fitScale() keeps only the marks a short fader has room for */
.mx-track { --mx-sl: 20px; }
.mx-scale { position: absolute; left: 0; top: 12px; bottom: 0; width: var(--mx-sl); pointer-events: none; }
.mx-scale span { position: absolute; right: 0; transform: translateY(50%); font: 9px/1 var(--font-mono); color: var(--text-3); white-space: nowrap; }
.mx-thumb { position: absolute; left: calc(var(--mx-sl) + 2px); width: 26px; height: 14px; border-radius: 3px; outline: none;
  background: linear-gradient(180deg, #e1deda 0%, #b3afa9 45%, #85817b 55%, #c6c2bc 100%); box-shadow: 0 3px 6px rgba(0,0,0,.6), inset 0 1px 0 #fff8; }
.mx-thumb i { position: absolute; left: 3px; right: 3px; top: 6px; height: 2px; background: var(--tc); border-radius: 1px; }
.mx-thumb:focus-visible { box-shadow: 0 0 0 2px var(--accent-2), 0 3px 6px rgba(0,0,0,.6); }
.mx-strip.moving .mx-thumb { box-shadow: 0 0 0 2px var(--human), 0 3px 8px rgba(0,0,0,.6); }
/* a finger's hold has picked the control up: a drag now moves it */
.mx-track.mx-held .mx-thumb { box-shadow: 0 0 0 2px var(--human), 0 3px 8px rgba(0,0,0,.6); }
.mk.mx-held { box-shadow: 0 0 0 2px var(--human); }
.mx-mwrap { position: relative; display: flex; flex-direction: column; padding-top: 12px; }
.mx-meter { flex: 1; width: 12px; display: block; }
.mx-peak { position: absolute; top: 0; right: -3px; width: 36px; height: 11px; padding: 0; border: 0; background: none; color: var(--text-3); font-size: 9px; line-height: 11px; text-align: right; cursor: pointer; display: none; }
.mx-strip:hover .mx-peak, .mx-master .mx-peak { display: block; }
.mx-peak.hot { color: var(--bad); display: block; }
.mx-db { height: 20px; padding: 0; border: 1px solid transparent; border-radius: var(--r-press); background: none; color: var(--text-2); font-size: 11px; cursor: text; }
.mx-db:hover { border-color: var(--line-2); }
/* automation: "auto" in pencil, "held" in grease pencil, beside the level (the unit gives way) and the pan */
.mx-dbrow { display: flex; align-items: center; gap: 2px; min-width: 0; }
.mx-dbrow .mx-db { flex: 1 1 auto; min-width: 0; }
.mx-pan { position: relative; }
.mx-am { flex: none; height: 20px; padding: 0 2px; border: 0; background: none; color: var(--text-2); font: italic 500 11px/1 var(--font-ui); cursor: pointer; }
.mx-am[data-mark="held"] { color: var(--accent-2); text-decoration: underline; text-underline-offset: 2px; }
.mx-am:hover { color: var(--text); }
.mx-am-pan { position: absolute; right: -6px; top: -4px; height: 14px; font-size: 10px; background: var(--bg); }
.mx-strip.sel .mx-am-pan { background: var(--bg-2); }
.mx-dbin { height: 20px; width: 100%; padding: 0 4px; border: 1px solid var(--accent-2); border-radius: var(--r-press); background: var(--bg); color: var(--text); font-size: 11px; text-align: center; outline: none; }
.mx-master { position: sticky; right: 0; z-index: 2; width: 96px; margin: 8px 8px 8px 6px; height: calc(100% - 16px); padding-top: 0; background: var(--bg-2); border-right: 0; border-left: var(--rule-2); }
.mx-master .mx-name b { font-family: var(--font-display); font-style: italic; font-weight: 800; font-stretch: 125%; font-variation-settings: var(--font-display-vars); font-size: 14px; overflow: visible; }
.mx-master .mx-chip { display: none; }
.mx-ro .mx-track { cursor: not-allowed; opacity: .7; }
.mx-strip.ew-agent-flash { animation: mx-agent 1.5s var(--ease) both; }
@keyframes mx-agent { 0%, 25% { outline: 1.5px solid var(--accent-2); outline-offset: -2px; } 100% { outline: 1.5px solid transparent; outline-offset: -2px; } }
/* the agent pointing at a strip: crop marks, its name above */
.mx-pres { z-index: 2; inset: 4px 2px 2px; }
.mx-pres > span { max-width: 80px; overflow: hidden; text-overflow: ellipsis; top: 10px; transform: none; }
@media (max-height: 760px) { .mx-pan-v { display: none; } }
`;
