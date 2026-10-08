// Gaffer Tape's window (core.multiband, devices/builtin/multiband.js): the three-band upward and downward compressor,
// opened big. Built only from the window's ctx (ui/plugin.js), like every editor.
//
//   The strip    the spectrum of what comes in (the window's own tap on the device's input, ctx.meter.tap), the three
//                bands' shapes over it (multiband-curve.js mbWeights: the kernel's own crossover), and the two splits as
//                dividers you drag (or Tab to and move with the arrow keys). The splits keep 1.5 times apart.
//   The master   DEPTH, the big knob (how much of it you hear); then what it is doing to the level, while the song
//                plays: the loudness coming out against the loudness going in, in LU, big ("−1.7 LU, quieter than it
//                came in", in the warning ink when it takes a decibel or more off), and an In and an Out meter (the
//                Out with its peak); then INPUT, OUTPUT and TIME.
//   The bands    low, mid and high, a column each (stacked under 900 px): the band's transfer curve, level in to level
//                out, drawn from the kernel's own functions (multiband-curve.js transfer): the curve you hear at this
//                depth in the device's colour, the full-depth one in pencil under it, the 1:1 line. Its two thresholds
//                sit on the curve as squares you drag sideways (the downward one hollow, the upward one filled; Shift:
//                fine; double-click: back to its default; right-click, a long press or the menu key: automation), and
//                can't cross. While the song plays, the band says how far it is holding the sound down or lifting it
//                now, with a bar, and a leader-green dot rides the curve where the band is. Under the curve: the
//                band's ratios, attack, release and gain (ctx.control, so lanes, menus and an agent's flash come with
//                them).
//   The readouts are worked out on the page: the window's own taps on the device's input and output (ctx.meter.tap,
//                each the two channels summed to one) read as a stream, the input through the kernel's own detectors
//                (multiband-curve.js mbSplit and mbStep, the same functions, so a band's readout is the gain the kernel
//                works out for a sound in the middle of the stereo), and both K-weighted (BS.1770, audio/measure.js's
//                coefficients) into 100 ms blocks: the loudness change is over the last 3 s.
//
// Every gesture is one undo step signed you (ctx.set: a drag's moves merge). An agent's change flashes what it moved in
// cool ink and the window's line says what it was (said()). Keys: Tab through the dividers, the knobs and the
// thresholds; arrows move a threshold 0.5 dB (Shift 0.1, Page Up/Down 6) or a divider a semitone (Shift a quarter,
// Page Up/Down half an octave); Home and End go to the ends.

import { h, css, clamp, tok } from '../dom.js';
import {
  MB_BANDS,
  MB_DET_MS,
  MB_CATCH_MS,
  MB_LIFT_MS,
  mbWeights,
  mbSplit,
  mbStep,
  mbCoef,
  mbMix,
  mbG,
  freqsOf,
  transfer,
  transferFull,
  bandOf,
} from '../../devices/builtin/multiband-curve.js';
import { kCoeffs } from '../../audio/measure.js';

const F_LO = 20,
  F_HI = 20000,
  LN_LO = Math.log(F_LO),
  LN_HI = Math.log(F_HI);
const DB_LO = -72,
  DB_HI = 0; // the transfer plots: level in and out, dB
const FFT = 4096; // the spectrum's tap
const STREAM = 16384; // the readouts' taps: room for the samples of a slow frame or two
const GR_DB = 18; // a band's bar: held down or lifted, this far each way
const SIDES = [
  { id: 'down', key: 'down_thresh', word: 'downward', title: 'Above this level the band is held down' },
  { id: 'up', key: 'up_thresh', word: 'upward', title: 'Below this level the band is lifted' },
];
const minus = (s) => s.replace(/^-/, '−');
const dbText = (v) => minus(`${v > 0.05 ? '+' : ''}${(Math.abs(v) < 0.05 ? 0 : v).toFixed(1)} dB`);
const hzText = (f) =>
  f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.?0+$/, '')} kHz` : `${Math.round(f)} Hz`;
const dbWords = (v) => (Math.abs(v) < 0.05 ? '0 dB' : `${v < 0 ? 'minus' : 'plus'} ${Math.abs(v).toFixed(1)} dB`);

export function mount(el, ctx) {
  css('plugin-multiband', CSS);
  const { app, def } = ctx;
  const color = /^#[0-9a-f]{6}$/i.test(def.look?.color || '') ? def.look.color : '#ec5a96';
  const sr = () => ctx.meter.sampleRate || 48000;
  const P = (k) => ctx.param(k);
  let vals = ctx.params();

  /* ---------------------------------------------------------------- the frame of it */
  const root = h('div.mb');
  const strut = h('div.mb-strut', { 'aria-hidden': 'true' });

  // the strip: the spectrum, the bands' shapes, the two splits
  const strip = h('div.mb-strip', {
    role: 'group',
    'aria-label': `${def.name}: the crossover. Two splits divide the sound into low, mid and high`,
  });
  const scv = ctx.kit.canvas({
    className: 'mb-scv',
    label: `${def.name}: the three bands over the spectrum of what comes in`,
  });
  strip.append(scv.el);
  const divs = ['xover_lo', 'xover_hi'].map((key, i) => {
    const lab = h('span.mb-div-l', { 'aria-hidden': 'true' });
    const d = h(
      'div.mb-div.pk-ctl',
      {
        role: 'slider',
        tabindex: 0,
        dataset: { key },
        'aria-valuemin': P(key).min,
        'aria-valuemax': P(key).max,
        'aria-label': i ? 'Split between mid and high' : 'Split between low and mid',
      },
      h('i.mb-dg', { 'aria-hidden': 'true' }),
      lab,
    );
    d.title = `${i ? 'Mid-high' : 'Low-mid'} split: drag sideways (Shift: fine), or the arrow keys. Double-click: back to ${hzText(P(key).def)}`;
    strip.append(d);
    return { key, el: d, lab, i };
  });

  // the master: DEPTH big, then INPUT, OUTPUT, TIME
  const depthCtl = ctx.control('depth', { size: 104, label: 'Depth' });
  depthCtl.classList.add('mb-depth');
  const inCtl = ctx.control('in_gain', { size: 40, label: 'Input' });
  const outCtl = ctx.control('out_gain', { size: 40, label: 'Output' });
  const timeCtl = ctx.control('time', { size: 40, label: 'Time' });
  // the two big knobs: how much of every band's lift, and of its hold, is used
  const upCtl = ctx.control('upward', { size: 40, label: 'Upward' });
  const downCtl = ctx.control('downward', { size: 40, label: 'Downward' });
  const depthSay = h('p.mb-dsay');
  // what it does to the level: out against in, big, and the two meters (the readouts' stream feeds them)
  const luNum = h('b.mb-lu', '–');
  const luSay = h('span.mb-lus', 'Out against in');
  const luWhen = h('span.sr-only', '');
  const meterIn = ctx.kit.meter({
    label: `${def.name}: the level going in`,
    read: () => rt.lvIn,
    orient: 'h',
    length: 88,
  });
  const meterOut = ctx.kit.meter({
    label: `${def.name}: the level coming out`,
    read: () => rt.lvOut,
    orient: 'h',
    length: 88,
  });
  const pkOut = h(
    'span.mb-pk',
    { title: 'The loudest peak going out in the last 2 seconds, dB. A safety ceiling holds everything at −1 dBTP' },
    '',
  );
  const loud = h(
    'div.mb-loud',
    { role: 'group', 'aria-label': 'Loudness: what comes out against what goes in' },
    h('p.mb-ld', { 'aria-live': 'polite', 'aria-atomic': 'true' }, luNum, ' ', luSay, luWhen),
    h('div.mb-mt', h('span.mb-ml', 'In'), meterIn.el),
    h('div.mb-mt', h('span.mb-ml', 'Out'), meterOut.el, pkOut),
  );
  const master = h(
    'section.mb-master',
    { 'aria-label': 'Depth, loudness, input, output, time, upward and downward' },
    depthCtl,
    depthSay,
    loud,
    h('div.mb-mrow', inCtl, outCtl, timeCtl, upCtl, downCtl),
  );

  // a column per band
  const bands = MB_BANDS.map((B) => {
    const cv = ctx.kit.canvas({ className: 'mb-pcv', label: `${B.name} band: its curve, level in to level out` });
    const plot = h('div.mb-plot', cv.el);
    const handles = SIDES.map((S) => {
      const key = `${B.id}_${S.key}`;
      const hd = h('div.mb-h.pk-ctl', {
        role: 'slider',
        tabindex: 0,
        dataset: { key, side: S.id, band: B.id },
        'aria-valuemin': P(key).min,
        'aria-valuemax': P(key).max,
        'aria-label': `${B.name} band, ${S.word} threshold`,
      });
      hd.title = `${S.title}: drag sideways (Shift: fine), or the arrow keys. Double-click: back to ${dbText(P(key).def)}. Right-click: automation`;
      plot.append(hd);
      return { side: S, key, el: hd };
    });
    const knob = (k, label, words) => {
      const c = ctx.control(`${B.id}_${k}`, { size: 40, label });
      // (each band's knobs share their labels: a screen reader hears the band too)
      c.querySelector('[role=slider]')?.setAttribute('aria-label', `${B.name} band ${words}`);
      return c;
    };
    const now = h('span.mb-now');
    const gr = ctx.kit.canvas({ className: 'mb-gr' });
    gr.el.setAttribute('aria-hidden', 'true');
    const range = h('span.mb-br');
    const head = h(
      'div.mb-bh',
      h('span.mb-bt', h('b.mb-bn', B.name), range),
      h('div.mb-nowrow', { 'aria-live': 'off' }, now, gr.el),
    );
    const ctl = h(
      'div.mb-ctl',
      knob('down_ratio', 'Down ratio', 'downward ratio'),
      knob('up_ratio', 'Up ratio', 'upward ratio'),
      knob('gain', 'Gain', 'gain'),
      knob('attack', 'Attack', 'attack'),
      knob('release', 'Release', 'release'),
    );
    const sum = h('p.mb-bsum', { 'aria-hidden': 'true' });
    const col = h('section.mb-band', { dataset: { band: B.id }, 'aria-label': `${B.name} band` }, head, plot, sum, ctl);
    return { B, cv, plot, handles, now, gr, range, sum, col, level: -Infinity, net: 0, shown: 0 };
  });
  const about = h(
    'p.mb-about',
    `${def.blurb}. Tips its hat to ${def.nod}. A safety ceiling holds everything it puts out at −1 dBTP.`,
  );
  root.append(strut, strip, h('div.mb-row', master, ...bands.map((b) => b.col)), about);
  el.append(root);

  /* ---------------------------------------------------------------- geometry */
  // the strip: frequency across, log; a little room each side for the labels
  const sGeo = () => {
    const w = strip.clientWidth || 600,
      hh = strip.clientHeight || 90;
    return { w, h: hh, l: 10, r: w - 10, t: 6, b: hh - 18 };
  };
  const xOfF = (f, g = sGeo()) => g.l + ((Math.log(clamp(f, F_LO, F_HI)) - LN_LO) / (LN_HI - LN_LO)) * (g.r - g.l);
  const fOfX = (x, g = sGeo()) => Math.exp(LN_LO + clamp((x - g.l) / Math.max(1, g.r - g.l), 0, 1) * (LN_HI - LN_LO));
  // a band's plot: a square, level in across and level out up, the same scale both ways (so 1:1 is the diagonal)
  const pGeo = (b) => {
    const w = b.plot.clientWidth || 220,
      hh = b.plot.clientHeight || 220,
      t = 6,
      bo = 18;
    const size = Math.max(40, Math.min(w - 32, hh - t - bo)),
      l = Math.max(26, Math.round((w - size + 20) / 2));
    return { w, h: hh, l, t, size, r: l + size, b: t + size };
  };
  const X = (g, db) => g.l + ((db - DB_LO) / (DB_HI - DB_LO)) * g.size;
  const Y = (g, db) => g.b - ((db - DB_LO) / (DB_HI - DB_LO)) * g.size;

  /* ---------------------------------------------------------------- what it shows, in step with the params */
  const freqs = () => freqsOf(vals, sr());
  // where a threshold sits on the plot: the level at the device's input that the detector reads as the threshold
  // (input gain added in the kernel), and the upward one never above the downward one (as the kernel takes it)
  const thrAt = (b, side) => {
    const p = bandOf(vals, b.B.id),
      gin = +vals.in_gain || 0;
    const t = side === 'down' ? p.thrD : Math.min(p.thrU, p.thrD);
    return t - gin;
  };
  function layout() {
    const sg = sGeo(),
      [f1, f2] = freqs();
    for (const d of divs) {
      const f = d.i ? f2 : f1;
      d.el.style.left = `${xOfF(f, sg).toFixed(1)}px`;
      d.lab.textContent = hzText(f);
      d.el.dataset.flip = xOfF(f, sg) > sg.r - 70 ? '1' : '';
    }
    for (const b of bands) {
      const g = pGeo(b);
      for (const hd of b.handles) {
        const x = thrAt(b, hd.side.id),
          cx = clamp(x, DB_LO, DB_HI),
          y = clamp(transfer(vals, b.B.id, cx), DB_LO - 6, DB_HI + 6);
        hd.el.style.transform = `translate(${X(g, cx).toFixed(1)}px, ${clamp(Y(g, y), g.t - 4, g.b + 4).toFixed(1)}px)`;
        hd.el.dataset.edge = x < DB_LO ? 'left' : x > DB_HI ? 'right' : '';
      }
    }
  }
  function words() {
    const [f1, f2] = freqs();
    for (const d of divs) {
      const v = +vals[d.key],
        f = d.i ? f2 : f1,
        ln = ctx.lane(d.key);
      d.el.setAttribute('aria-valuenow', String(Math.round(v)));
      d.el.setAttribute(
        'aria-valuetext',
        hzText(f) +
          (Math.abs(f - v) > 0.5 ? `, kept 1.5 times above the low split (set to ${hzText(v)})` : '') +
          (ln ? (ln.held ? ', held' : ', follows its lane') : ''),
      );
      d.el.dataset.lane = ln ? (ln.held ? 'held' : 'auto') : '';
    }
    const ranges = [`under ${hzText(f1)}`, `${hzText(f1)} to ${hzText(f2)}`, `over ${hzText(f2)}`];
    bands.forEach((b, i) => {
      b.range.textContent = ranges[i];
      const p = bandOf(vals, b.B.id);
      for (const hd of b.handles) {
        const v = hd.side.id === 'down' ? p.thrD : p.thrU,
          ln = ctx.lane(hd.key);
        hd.el.setAttribute('aria-valuenow', String(+v.toFixed(1)));
        hd.el.setAttribute(
          'aria-valuetext',
          `${dbWords(v)}${hd.side.id === 'up' && p.thrU > p.thrD ? ", working as the downward threshold (it can't sit above it)" : ''}${ln ? (ln.held ? ', held' : ', follows its lane') : ''}`,
        );
      }
      const sig = `${p.thrD}|${p.rD}|${p.thrU}|${p.rU}`;
      if (b.sum.dataset.sig !== sig) {
        b.sum.dataset.sig = sig;
        b.sum.replaceChildren(
          h('span.mb-lg', h('i.mb-sq', { dataset: { side: 'down' } }), `Holds above ${dbText(p.thrD)}, ${ratio(p.rD)}`),
          h(
            'span.mb-lg',
            h('i.mb-sq', { dataset: { side: 'up' } }),
            `Lifts below ${dbText(Math.min(p.thrU, p.thrD))}, ${ratio(p.rU)}`,
          ),
        );
      }
    });
    const d = Math.round(+vals.depth);
    depthSay.textContent =
      d <= 0
        ? 'Dry: the sound as it came in'
        : d >= 100
          ? 'All of it: the full sound'
          : `${d}% of the compressed sound, ${100 - d}% dry`;
  }
  const ratio = (r) => `${r < 9.95 ? r.toFixed(1) : Math.round(r)}:1`;
  function syncAll() {
    layout();
    words();
    scv.dirty();
    for (const b of bands) b.cv.dirty();
  }

  /* ---------------------------------------------------------------- the edits: one undo step a gesture, signed you */
  const label = (key) => {
    if (key === 'xover_lo') return `${def.name}: low-mid split`;
    if (key === 'xover_hi') return `${def.name}: mid-high split`;
    const [b, ...rest] = key.split('_');
    return `${def.name}: ${b} band ${rest.join(' ').replace('thresh', 'threshold')}`;
  };
  // (fresh: a reset is a discrete move, always an undo step of its own)
  const set = (key, v, gesture = 'end', fresh = false) => {
    const r = ctx.set({ [key]: v }, { gesture, label: label(key), fresh });
    if (r && r.ok === false && r.error) ctx.status(r.error);
    return r;
  };
  // a threshold's value kept on its own side of the other one (an upward one an agent set above the downward one is
  // working as the downward one already: then the downward one moves freely)
  const thrClamp = (b, side, v) => {
    const p = P(`${b.B.id}_${side}_thresh`),
      o = bandOf(vals, b.B.id);
    v = clamp(v, p.min, p.max);
    if (side === 'up') return Math.min(v, o.thrD);
    return o.thrU <= o.thrD ? Math.max(v, o.thrU) : v;
  };
  // a split kept 1.5 times from the other one as the kernel places it (and in its own range)
  const splitClamp = (key, f) => {
    const p = P(key),
      [f1, f2] = freqs();
    f = clamp(f, p.min, p.max);
    return key === 'xover_lo' ? Math.min(f, f2 / 1.5) : Math.max(f, f1 * 1.5);
  };

  // One pointer gesture on `target`: move(ev) while it lasts, then end() once (a long press that opens the menu stops it)
  const EVTS = ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'];
  function gesture(target, e, move, end) {
    try {
      target.setPointerCapture(e.pointerId);
    } catch (err) {
      /* gone */
    }
    const pid = e.pointerId;
    let over = false;
    const on = (ev) => {
      if (over || (ev.pointerId != null && ev.pointerId !== pid)) return;
      if (ev.type === 'pointermove') move(ev);
      else stop();
    };
    const stop = () => {
      if (over) return;
      over = true;
      for (const t of EVTS) target.removeEventListener(t, on);
      end();
    };
    for (const t of EVTS) target.addEventListener(t, on);
    return stop;
  }
  let drag = null;
  // a threshold: drag sideways along the level axis
  for (const b of bands)
    for (const hd of b.handles) {
      const key = hd.key;
      hd.el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        hd.el.focus({ preventScroll: true });
        const g = pGeo(b),
          perPx = (DB_HI - DB_LO) / g.size;
        const d = (drag = {
          key,
          x0: e.clientX,
          v0: +vals[key],
          fine: e.shiftKey,
          touch: e.pointerType === 'touch',
          moved: false,
          last: null,
        });
        hd.el.classList.add('drag');
        d.stop = gesture(
          hd.el,
          e,
          (ev) => {
            if (!d.moved && Math.abs(ev.clientX - d.x0) < (d.touch ? 8 : 2)) return;
            if (!d.moved) {
              d.moved = true;
              d.x0 = ev.clientX;
            }
            if (ev.shiftKey !== d.fine) {
              d.fine = ev.shiftKey;
              d.x0 = ev.clientX;
              d.v0 = +vals[key];
            }
            const v =
              Math.round(thrClamp(b, hd.side.id, d.v0 + (ev.clientX - d.x0) * perPx * (d.fine ? 0.2 : 1)) * 10) / 10;
            if (v === d.last) return;
            d.last = v;
            set(key, v, 'move');
          },
          () => {
            if (drag === d) drag = null;
            hd.el.classList.remove('drag');
            if (d.moved && d.last != null) set(key, d.last, 'end');
          },
        );
      });
      hd.el.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        set(key, thrClamp(b, hd.side.id, P(key).def), 'end', true);
      });
      hd.el.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const v = +vals[key],
          st = e.shiftKey ? 0.1 : 0.5,
          p = P(key);
        const to = {
          ArrowRight: v + st,
          ArrowUp: v + st,
          ArrowLeft: v - st,
          ArrowDown: v - st,
          PageUp: v + 6,
          PageDown: v - 6,
          Home: p.min,
          End: p.max,
        }[e.key];
        if (to == null) return;
        e.preventDefault();
        e.stopPropagation();
        set(key, Math.round(thrClamp(b, hd.side.id, to) * 10) / 10);
      });
      ctx.kit.menuOn(
        hd.el,
        (anchor, e) => ctx.menu(key, e && e.clientX != null ? e : anchor),
        () => drag?.stop?.(),
      );
    }
  // a split: drag sideways along the frequency axis
  for (const d0 of divs) {
    const { key, el: dv } = d0;
    dv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dv.focus({ preventScroll: true });
      const d = (drag = {
        key,
        x0: e.clientX,
        f0: +vals[key],
        fine: e.shiftKey,
        touch: e.pointerType === 'touch',
        moved: false,
        last: null,
      });
      dv.classList.add('drag');
      d.stop = gesture(
        dv,
        e,
        (ev) => {
          if (!d.moved && Math.abs(ev.clientX - d.x0) < (d.touch ? 8 : 2)) return;
          if (!d.moved) {
            d.moved = true;
            d.x0 = ev.clientX;
          }
          if (ev.shiftKey !== d.fine) {
            d.fine = ev.shiftKey;
            d.x0 = ev.clientX;
            d.f0 = +vals[key];
          }
          const g = sGeo(),
            oct = ((((ev.clientX - d.x0) / Math.max(1, g.r - g.l)) * (LN_HI - LN_LO)) / Math.LN2) * (d.fine ? 0.2 : 1);
          const f = Math.round(splitClamp(key, d.f0 * Math.pow(2, oct)));
          if (f === d.last) return;
          d.last = f;
          set(key, f, 'move');
        },
        () => {
          if (drag === d) drag = null;
          dv.classList.remove('drag');
          if (d.moved && d.last != null) set(key, d.last, 'end');
        },
      );
    });
    dv.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      set(key, splitClamp(key, P(key).def), 'end', true);
    });
    dv.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const f = +vals[key],
        p = P(key);
      const oct = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      let to = null;
      if (oct != null) to = f * Math.pow(2, oct * (e.shiftKey ? 1 / 48 : 1 / 12));
      else if (e.key === 'PageUp') to = f * Math.SQRT2;
      else if (e.key === 'PageDown') to = f / Math.SQRT2;
      else if (e.key === 'Home') to = p.min;
      else if (e.key === 'End') to = p.max;
      if (to == null) return;
      e.preventDefault();
      e.stopPropagation();
      set(key, Math.round(splitClamp(key, to)));
    });
    ctx.kit.menuOn(
      dv,
      (anchor, e) => ctx.menu(key, e && e.clientX != null ? e : anchor),
      () => drag?.stop?.(),
    );
  }

  /* ---------------------------------------------------------------- the readouts: worked out on the page */
  // The device's input and output, from the window's own taps (AnalyserNodes: the two channels summed to one), read as
  // a stream: each frame takes the samples that came in since the last one (by the audio clock). The input goes through
  // the kernel's own detectors (mbSplit, then mbStep a band, with this window's params): each band's level and the gain
  // its curve gives it now. Both are K-weighted into 100 ms blocks: the loudness out against in over the last 3 s
  // (blocks where nothing came in don't count), and the In and Out meters.
  const live = { until: 0, playing: false, drawing: false };
  const rt = {
    t: -1,
    rate: 0,
    bufIn: new Float32Array(STREAM),
    bufOut: new Float32Array(STREAM),
    x: new Float64Array(STREAM),
    B: [0, 1, 2].map(() => new Float64Array(STREAM)),
    z: new Float64Array(14),
    S: new Float64Array(18),
    kIn: null,
    kOut: null,
    blk: 0,
    pos: 0,
    aIn: 0,
    aOut: 0,
    ring: [],
    lvIn: { peak: -120, rms: -120 },
    lvOut: { peak: -120, rms: -120 },
    pk: -Infinity,
    pkAt: 0,
    du: null,
    duAt: 0,
    quietSince: 0,
    told: false,
    played: false,
  };
  const kState = (rate) => {
    const [s, hp] = kCoeffs(rate);
    return { s, hp, z: new Float64Array(8) };
  };
  // K-weighting over x[i0..i1) with the filter's state carried on; the sum of the squares
  function kSquares(k, x, i0, i1) {
    const { s, hp, z } = k;
    let x1 = z[0],
      x2 = z[1],
      y1 = z[2],
      y2 = z[3],
      u1 = z[4],
      u2 = z[5],
      w1 = z[6],
      w2 = z[7],
      sum = 0;
    for (let i = i0; i < i1; i++) {
      const v = x[i],
        y = s.b0 * v + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
      x2 = x1;
      x1 = v;
      y2 = y1;
      y1 = y;
      const w = hp.b0 * y + hp.b1 * u1 + hp.b2 * u2 - hp.a1 * w1 - hp.a2 * w2;
      u2 = u1;
      u1 = y;
      w2 = w1;
      w1 = w;
      sum += w * w;
    }
    z[0] = x1;
    z[1] = x2;
    z[2] = y1;
    z[3] = y2;
    z[4] = u1;
    z[5] = u2;
    z[6] = w1;
    z[7] = w2;
    return sum;
  }
  function restart() {
    rt.t = -1;
    rt.z.fill(0);
    rt.S.fill(0);
    rt.ring.length = 0;
    rt.pos = 0;
    rt.aIn = 0;
    rt.aOut = 0;
    rt.du = null;
    rt.pk = -Infinity;
    rt.kIn = rt.kOut = null;
    rt.quietSince = 0;
    rt.told = false;
    for (const b of bands) {
      b.level = -Infinity;
      b.net = 0;
      b.shown = 0;
    }
  }
  const dB = (x) => (x > 1e-12 ? 20 * Math.log10(x) : -120);
  function stream(now) {
    const ai = ctx.meter.tap?.('input', { fftSize: STREAM, smoothing: 0 }),
      ao = ctx.meter.tap?.('output', { fftSize: STREAM, smoothing: 0 });
    if (!ai || !ao) return;
    const rate = ai.context.sampleRate,
      t = ai.context.currentTime;
    if (rate !== rt.rate || !rt.kIn) {
      rt.rate = rate;
      rt.kIn = kState(rate);
      rt.kOut = kState(rate);
      rt.blk = Math.round(0.1 * rate);
    }
    let n = rt.t < 0 ? Math.round(0.05 * rate) : Math.round((t - rt.t) * rate);
    rt.t = t;
    if (n <= 0) return;
    if (n > STREAM) n = STREAM;
    ai.getFloatTimeDomainData(rt.bufIn);
    ao.getFloatTimeDomainData(rt.bufOut);
    const o = STREAM - n,
      xi = rt.bufIn,
      xo = rt.bufOut;
    // the meters: the chunk's peak and RMS, in and out
    let pi = 0,
      si = 0,
      po = 0,
      so = 0;
    for (let i = o; i < STREAM; i++) {
      const a = xi[i],
        c = xo[i];
      si += a * a;
      so += c * c;
      if (a > pi) pi = a;
      else if (-a > pi) pi = -a;
      if (c > po) po = c;
      else if (-c > po) po = -c;
    }
    rt.lvIn = { peak: dB(pi), rms: dB(Math.sqrt(si / n)) };
    rt.lvOut = { peak: dB(po), rms: dB(Math.sqrt(so / n)) };
    if (dB(po) >= rt.pk || now - rt.pkAt > 2000) {
      rt.pk = dB(po);
      rt.pkAt = now;
    }
    // loudness: K-weighted squares into 100 ms blocks, in and out side by side
    for (let i = o; i < STREAM; ) {
      const m = Math.min(STREAM - i, rt.blk - rt.pos);
      rt.aIn += kSquares(rt.kIn, xi, i, i + m);
      rt.aOut += kSquares(rt.kOut, xo, i, i + m);
      rt.pos += m;
      i += m;
      if (rt.pos >= rt.blk) {
        rt.ring.push([rt.aIn / rt.blk, rt.aOut / rt.blk]);
        if (rt.ring.length > 30) rt.ring.shift();
        rt.pos = 0;
        rt.aIn = 0;
        rt.aOut = 0;
      }
    }
    let sIn = 0,
      sOut = 0,
      kept = 0;
    for (const [pin, pout] of rt.ring)
      if (pin > 0 && -0.691 + 10 * Math.log10(pin) > -70) {
        sIn += pin;
        sOut += pout;
        kept++;
      }
    rt.du = kept >= 5 && sIn > 0 && sOut > 0 ? 10 * Math.log10(sOut / sIn) : rt.du;
    // the detectors: the input at the device's INPUT gain, through the kernel's crossover and each band's mbStep
    const gin = Math.pow(10, (+vals.in_gain || 0) / 20),
      x = rt.x;
    for (let i = 0; i < n; i++) x[i] = xi[o + i] * gin;
    const [f1, f2] = freqsOf(vals, rate),
      g1 = mbG(f1, rate),
      g2 = mbG(f2, rate);
    mbSplit(x, n, rt.z, 0, g1, g1, g2, g2, rt.B[0], rt.B[1], rt.B[2]);
    const tm = (+vals.time || 100) / 100,
      cC = mbCoef(MB_CATCH_MS, rate),
      cL = mbCoef(MB_LIFT_MS, rate),
      d = clamp((+vals.depth || 0) / 100, 0, 1);
    let any = false;
    bands.forEach((b, j) => {
      const p = bandOf(vals, b.B.id),
        cA = mbCoef(p.att * tm, rate),
        cR = mbCoef(p.rel * tm, rate),
        cD = mbCoef(MB_DET_MS[j], rate),
        X = rt.B[j];
      let lo = Infinity,
        hi = -Infinity;
      const sd = (vals.downward ?? 100) / 100,
        su = (vals.upward ?? 100) / 100;
      for (let i = 0; i < n; i++) {
        const g = mbStep(X[i] * X[i], rt.S, 6 * j, p.thrD, p.rD, p.thrU, p.rU, cA, cR, cD, cC, cL, sd, su);
        if (g < lo) lo = g;
        if (g > hi) hi = g;
      }
      // what the band does now, at this depth (its own gain aside): the most it held down in this chunk, else the most
      // it lifted
      const g = lo < -0.05 ? lo : hi;
      b.net = 20 * Math.log10(mbMix(g, 0, d));
      const lv = 10 * Math.log10(2 * rt.S[6 * j + 1] + 1e-30);
      b.level = lv > -90 ? lv : -Infinity;
      if (b.level > -90) any = true;
    });
    if (any) live.until = now + 600;
  }
  const signed = (v, d = 1) => minus(`${v >= 0.05 ? '+' : ''}${(Math.abs(v) < 0.05 ? 0 : v).toFixed(d)}`);
  // the words: the loudness change, big, and each band's
  function readouts(now) {
    const du = rt.du;
    if (du == null) {
      luNum.textContent = '–';
      luSay.textContent = rt.played ? 'Nothing came in' : 'Out against in';
      luWhen.textContent = '';
      loud.dataset.state = '';
    } else if (now - rt.duAt > 250 || !live.playing) {
      rt.duAt = now;
      luNum.textContent = `${signed(du)} LU`;
      luSay.textContent =
        du <= -0.3 ? 'quieter than it came in' : du >= 0.3 ? 'louder than it came in' : 'as loud as it came in';
      // (stopped: the last reading stays, dimmed; a screen reader hears when it was)
      luWhen.textContent = live.playing ? '' : ', when it last played';
      loud.dataset.state = du <= -1 ? 'quieter' : du >= 1 ? 'louder' : 'level';
      loud.dataset.lu = du.toFixed(2);
      if (!live.playing) loud.dataset.state += ' last';
      // taking a decibel or more off for 2 s: say so in the window's line too, once each time it gets there
      if (live.playing && du <= -1) {
        if (!rt.quietSince) rt.quietSince = now;
        else if (!rt.told && now - rt.quietSince > 2000) {
          rt.told = true;
          ctx.status(
            `Coming out ${Math.abs(du).toFixed(1)} LU quieter than it goes in. OUTPUT or the band gains bring it back up.`,
          );
        }
      } else {
        rt.quietSince = 0;
        if (du > -0.5) rt.told = false;
      }
    }
    pkOut.textContent = Number.isFinite(rt.pk) && rt.pk > -119 ? minus(rt.pk.toFixed(1)) : '';
    for (const b of bands) {
      const on = live.playing && Number.isFinite(b.level);
      // a band's readout falls at once and comes back over about 150 ms, so a hit's front shows
      b.shown = !on ? 0 : b.net < b.shown ? b.net : b.shown + (b.net - b.shown) * 0.25;
      const v = b.shown,
        t = !on
          ? ''
          : v <= -0.05
            ? `held ${Math.abs(v).toFixed(1)} dB`
            : v >= 0.05
              ? `lifted ${v.toFixed(1)} dB`
              : 'untouched';
      if (b.now.textContent !== t) b.now.textContent = t;
      const ds = on ? b.level.toFixed(1) : '';
      if (b.col.dataset.level !== ds) b.col.dataset.level = ds;
      const gs = on ? v.toFixed(1) : '';
      if (b.col.dataset.gain !== gs) b.col.dataset.gain = gs;
      b.gr.dirty();
    }
  }

  /* ---------------------------------------------------------------- the drawing */
  const ink = {};
  const readInks = () => {
    for (const k of [
      '--text',
      '--text-2',
      '--text-3',
      '--line',
      '--line-2',
      '--bg',
      '--accent',
      '--agent',
      '--font-mono',
    ])
      ink[k] = tok(k, root) || tok(k);
  };
  readInks();
  const phone = () => !!el.closest('.pw-phone');
  const animate = () => live.playing || performance.now() < live.until;
  // the strip
  const specBuf = { f: null };
  scv.set({
    animate,
    draw: (g, { w, h: hh }) => {
      const sg = { w, h: hh, l: 10, r: w - 10, t: 6, b: hh - 18 };
      g.fillStyle = ink['--bg'] || '#141210';
      g.fillRect(0, 0, w, hh);
      // decades
      g.lineWidth = 1;
      for (const f of [100, 1000, 10000]) {
        const x = Math.round(xOfF(f, sg)) + 0.5;
        g.strokeStyle = ink['--line'];
        g.beginPath();
        g.moveTo(x, sg.t);
        g.lineTo(x, sg.b);
        g.stroke();
      }
      g.font = `${phone() ? 12 : 11}px ${ink['--font-mono'] || 'monospace'}`;
      g.fillStyle = ink['--text-3'];
      g.textBaseline = 'top';
      g.textAlign = 'center';
      for (const [f, t] of [
        [100, '100'],
        [1000, '1k'],
        [10000, '10k'],
      ])
        g.fillText(t, xOfF(f, sg), sg.b + 3);
      // what comes in: the spectrum, tilted 4.5 dB per octave about 1 kHz so a mix reads about level
      const an = live.playing || animate() ? ctx.meter.tap?.('input', { fftSize: FFT, smoothing: 0.75 }) : null;
      if (an) {
        if (!specBuf.f || specBuf.f.length !== an.frequencyBinCount) specBuf.f = new Float32Array(an.frequencyBinCount);
        an.getFloatFrequencyData(specBuf.f);
        const hz = an.context.sampleRate / an.fftSize,
          B = specBuf.f;
        g.fillStyle = ink['--line-2'];
        g.globalAlpha = 0.6;
        g.beginPath();
        g.moveTo(sg.l, sg.b);
        for (let x = sg.l; x <= sg.r; x += 2) {
          const f = fOfX(x, sg),
            k = clamp(Math.round(f / hz), 1, B.length - 1),
            v = (B[k] > -200 ? B[k] : -200) + 4.5 * Math.log2(f / 1000);
          g.lineTo(x, sg.b - clamp((v + 90) / 78, 0, 1) * (sg.b - sg.t));
        }
        g.lineTo(sg.r, sg.b);
        g.closePath();
        g.fill();
        g.globalAlpha = 1;
      }
      // the bands' shapes: each one's share of a tone at each frequency (the kernel's crossover), 0 to -24 dB
      const [f1, f2] = freqs(),
        w3 = [0, 0, 0];
      for (let bi = 0; bi < 3; bi++) {
        g.strokeStyle = color;
        g.globalAlpha = 0.85;
        g.lineWidth = 1.5;
        g.beginPath();
        for (let x = sg.l; x <= sg.r; x += 2) {
          mbWeights(fOfX(x, sg), f1, f2, sr(), w3);
          const db = 20 * Math.log10(Math.max(w3[bi], 1e-6)),
            y = sg.t + 2 + clamp(-db / 24, 0, 1) * (sg.b - sg.t - 2);
          if (x === sg.l) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        g.globalAlpha = 1;
      }
      // the bands' names, in the middle of each
      g.font = `600 ${phone() ? 12 : 11.5}px ${tok('--font-ui', root) || 'sans-serif'}`;
      g.fillStyle = ink['--text-2'];
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      const mid = [Math.sqrt(F_LO * f1), Math.sqrt(f1 * f2), Math.sqrt(f2 * F_HI)];
      MB_BANDS.forEach((B, i) => g.fillText(B.name, xOfF(mid[i], sg), sg.t + (sg.b - sg.t) * 0.62));
    },
  });
  // each band's plot
  for (const b of bands) {
    b.cv.set({
      animate,
      draw: (g) => {
        const pg = pGeo(b);
        g.fillStyle = ink['--bg'] || '#141210';
        g.fillRect(pg.l, pg.t, pg.size, pg.size);
        // the grid: every 12 dB, 0 dB heavier
        g.lineWidth = 1;
        for (let db = DB_LO; db <= DB_HI; db += 12) {
          const x = Math.round(X(pg, db)) + 0.5,
            y = Math.round(Y(pg, db)) + 0.5;
          g.strokeStyle = db === 0 ? ink['--line-2'] : ink['--line'];
          g.beginPath();
          g.moveTo(x, pg.t);
          g.lineTo(x, pg.b);
          g.moveTo(pg.l, y);
          g.lineTo(pg.r, y);
          g.stroke();
        }
        g.font = `${phone() ? 12 : 10.5}px ${ink['--font-mono'] || 'monospace'}`;
        g.fillStyle = ink['--text-3'];
        g.textAlign = 'right';
        g.textBaseline = 'middle';
        for (const db of [-60, -36, -12]) g.fillText(minus(String(db)), pg.l - 4, Y(pg, db));
        g.textAlign = 'center';
        g.textBaseline = 'top';
        for (const db of [-60, -36, -12]) g.fillText(minus(String(db)), X(pg, db), pg.b + 4);
        g.save();
        g.beginPath();
        g.rect(pg.l, pg.t, pg.size, pg.size);
        g.clip();
        // 1:1, the full-depth curve in pencil, then the curve at this depth in the device's colour
        g.strokeStyle = ink['--line-2'];
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(X(pg, DB_LO), Y(pg, DB_LO));
        g.lineTo(X(pg, DB_HI), Y(pg, DB_HI));
        g.stroke();
        g.setLineDash([]);
        const curve = (fn, color2, width, alpha) => {
          g.strokeStyle = color2;
          g.lineWidth = width;
          g.globalAlpha = alpha;
          g.lineJoin = 'round';
          g.beginPath();
          for (let i = 0; i <= 144; i++) {
            const x = DB_LO + ((DB_HI - DB_LO) * i) / 144,
              y = fn(vals, b.B.id, x);
            if (i) g.lineTo(X(pg, x), Y(pg, y));
            else g.moveTo(X(pg, x), Y(pg, y));
          }
          g.stroke();
          g.globalAlpha = 1;
        };
        // the thresholds' guides
        g.strokeStyle = ink['--line-2'];
        g.lineWidth = 1;
        for (const hd of b.handles) {
          const x = Math.round(X(pg, thrAt(b, hd.side.id))) + 0.5;
          g.beginPath();
          g.moveTo(x, pg.t);
          g.lineTo(x, pg.b);
          g.stroke();
        }
        curve(transferFull, ink['--text-3'], 1, 0.9);
        curve(transfer, color, 2.25, 1);
        // where the band is now (while it plays): leader green, on the curve
        if (live.playing && Number.isFinite(b.level)) {
          const x = clamp(b.level, DB_LO, DB_HI),
            y = transfer(vals, b.B.id, x);
          g.fillStyle = ink['--accent'] || '#d9f36a';
          g.fillRect(Math.round(X(pg, x)) - 4, Math.round(Y(pg, y)) - 4, 8, 8);
        }
        g.restore();
      },
    });
  }

  // each band's bar: held down to the left of the middle, lifted to the right, GR_DB each way
  for (const b of bands) {
    b.gr.set({
      draw: (g, { w, h: hh }) => {
        const mid = Math.round(w / 2);
        g.fillStyle = ink['--line'] || '#2f2b25';
        g.fillRect(0, Math.round(hh / 2) - 1, w, 2);
        g.fillStyle = ink['--line-2'] || '#46413a';
        g.fillRect(mid, 0, 1, hh);
        const v = b.shown;
        if (!live.playing || Math.abs(v) < 0.05) return;
        const len = Math.max(1, Math.min(1, Math.abs(v) / GR_DB) * (w / 2 - 1));
        g.fillStyle = color;
        if (v < 0) g.fillRect(mid - len, 1, len, hh - 2);
        else g.fillRect(mid + 1, 1, len, hh - 2);
      },
    });
  }

  /* ---------------------------------------------------------------- changes: anyone's */
  const SIDE_KEY = /^(low|mid|high)_(down|up)_thresh$/;
  const off = ctx.on((evt) => {
    vals = evt.params || ctx.params();
    if (evt.kind === 'lane') {
      layout();
      for (const b of bands) b.cv.dirty();
      scv.dirty();
      return;
    }
    syncAll();
    // an agent's change: what it moved flashes in its ink (the knobs flash themselves)
    if (evt.kind === 'do' && evt.by && ctx.isAgent(evt.by)) {
      for (const k of evt.keys || []) {
        const m = SIDE_KEY.exec(k);
        if (m) {
          const b = bands.find((x) => x.B.id === m[1]),
            hd = b?.handles.find((x) => x.side.id === m[2]);
          if (hd) ctx.flash(hd.el);
        }
        const dv = divs.find((x) => x.key === k);
        if (dv) ctx.flash(dv.el);
      }
    }
  });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
  ro?.observe(strip);
  for (const b of bands) ro?.observe(b.plot);
  syncAll();

  // (for the checks, tools/multiband-test.js: where a level or a frequency is on the screen)
  root.mbMap = {
    plotXY(band, dbIn, dbOut) {
      const b = bands.find((x) => x.B.id === band),
        g = pGeo(b),
        r = b.plot.getBoundingClientRect();
      return { x: r.left + X(g, dbIn), y: r.top + Y(g, dbOut ?? transfer(vals, band, dbIn)) };
    },
    stripX(f) {
      const r = strip.getBoundingClientRect();
      return r.left + xOfF(f);
    },
    levels: () => bands.map((b) => b.level),
    // the readouts as the window works them out: the loudness change (LU, null before anything played), the Out
    // meter's level and held peak (dB), and each band's held (negative) or lifted (positive) dB now
    readouts: () => ({
      lu: rt.du,
      out: { ...rt.lvOut },
      inp: { ...rt.lvIn },
      peak: rt.pk,
      bands: bands.map((b) => (live.playing ? b.shown : null)),
    }),
  };

  return {
    update(evt) {
      if (evt?.type === 'on' || evt?.type === 'lanes') {
        words();
        syncAll();
      }
    },
    frame(now) {
      const playing = !!app.engine?.playing;
      if (playing && !live.playing) {
        restart();
        rt.played = true;
      }
      const was = live.playing;
      live.playing = playing;
      if (playing) stream(now);
      else if (was) {
        for (const b of bands) b.level = -Infinity;
        rt.lvIn = { peak: -120, rms: -120 };
        rt.lvOut = { peak: -120, rms: -120 };
      }
      if (playing || was) readouts(now);
      // (once the canvases stop moving, one more drawing without the dots and the spectrum)
      const moving = animate();
      if (live.drawing && !moving) {
        scv.dirty();
        for (const b of bands) {
          b.cv.dirty();
          b.gr.dirty();
        }
      }
      live.drawing = moving;
    },
    // what an agent's change to a threshold or a split did, in words, for the window's line; null: the window's own
    said(keys) {
      if (keys.length !== 1) return null;
      const k = keys[0],
        m = SIDE_KEY.exec(k);
      if (m)
        return `moved the ${m[1]} band's ${m[2] === 'down' ? 'downward' : 'upward'} threshold to ${dbText(+vals[k])}.`;
      if (k === 'xover_lo' || k === 'xover_hi')
        return `moved the ${k === 'xover_lo' ? 'low-mid' : 'mid-high'} split to ${hzText(+vals[k])}.`;
      return null;
    },
    unmount() {
      off();
      ro?.disconnect();
      drag?.stop?.();
      scv.destroy();
      meterIn.destroy();
      meterOut.destroy();
      for (const b of bands) {
        b.cv.destroy();
        b.gr.destroy();
      }
      root.remove();
    },
  };
}

const CSS = `
/* Gaffer Tape's window (ui/editors/multiband.js): a strip of the spectrum with the two splits, then DEPTH and a column
   per band, each its curve on a hairline grid with its two thresholds on it, its knobs under. Hairlines between
   regions, no boxes; the curves in the device's colour; what you press has the one 2 px corner */
.mb { display: flex; flex-direction: column; min-height: 100%; }
.mb-strut { width: 980px; max-width: 100%; height: 0; }
.mb-strip { position: relative; flex: none; height: 84px; border-bottom: var(--rule); background: var(--bg); touch-action: none; user-select: none; -webkit-user-select: none; }
.mb-strip .mb-scv { position: absolute; inset: 0; width: 100%; height: 100%; }
/* a split: a line the strip's height with a square to take hold of, its frequency beside it */
.mb .mb-div.pk-ctl { position: absolute; display: block; top: 0; bottom: 0; left: 0; width: 16px; margin-left: -8px; gap: 0; cursor: ew-resize; touch-action: none; outline: none; z-index: 2; }
.mb-div::before { content: ''; position: absolute; left: 7px; top: 0; bottom: 0; width: 2px; background: var(--text-2); }
.mb-div .mb-dg { position: absolute; left: 2px; top: 5px; width: 12px; height: 12px; background: var(--text); border-radius: var(--r-press); }
.mb-div-l { position: absolute; top: 4px; left: 18px; padding: 0 3px; background: var(--bg); font: 400 11px/14px var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text); white-space: nowrap; pointer-events: none; }
.mb-div[data-flip="1"] .mb-div-l { left: auto; right: 18px; }
.mb-div:hover::before, .mb-div.drag::before { background: var(--text); }
.mb-div:focus-visible .mb-dg { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.mb-div[data-lane="auto"] .mb-div-l::after { content: ' auto'; color: var(--text-3); font-style: italic; }
.mb-div[data-lane="held"] .mb-div-l::after { content: ' held'; color: var(--accent-2); font-style: italic; }
/* depth and the master knobs, then the bands: a column each */
.mb-row { display: grid; grid-template-columns: 180px repeat(3, minmax(0, 1fr)); flex: 1 0 auto; }
.mb-master { display: grid; justify-items: center; align-content: start; gap: 6px; padding: 12px 12px 12px; }
.mb-depth .pk-l { font-size: 13px; color: var(--text); }
.mb-depth .pk-v { font-size: 15px; }
.mb-dsay { min-height: 2.6em; max-width: 150px; margin: 0 0 4px; font-size: 12px; line-height: 1.35; color: var(--text-3); text-align: center; }
/* what it does to the level: out against in, in display figures, then the two meters */
.mb-loud { display: grid; justify-items: center; gap: 3px; width: 100%; margin: 0; padding: 6px 0 0; border-top: var(--rule); }
.mb-ld { display: grid; justify-items: center; gap: 2px; margin: 0 0 2px; text-align: center; }
.mb-lu { font-family: var(--font-display); font-style: italic; font-weight: 800; font-stretch: 112%; font-variation-settings: 'wdth' 112; font-size: 26px; line-height: 1; letter-spacing: -.005em; font-variant-numeric: tabular-nums; color: var(--text); white-space: nowrap; }
.mb-lus { max-width: 156px; font-size: 12px; line-height: 1.3; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mb-loud[data-state~="quieter"] .mb-lu, .mb-loud[data-state~="quieter"] .mb-lus { color: var(--warn); }
.mb-loud[data-state~="last"] .mb-lu { color: var(--text-3); }
.mb-mt { display: grid; grid-template-columns: 24px 88px 36px; align-items: center; column-gap: 5px; }
.mb-ml { font: 400 11px/1 var(--font-mono); color: var(--text-3); text-align: right; }
.mb-mt .pk-meter { height: 8px; }
.mb-pk { font: 400 11px/1 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-2); white-space: nowrap; }
.mb-mrow { display: grid; grid-template-columns: repeat(3, auto); justify-content: center; gap: 8px 4px; }
.mb-band { min-width: 0; padding: 10px 14px 12px; border-left: var(--rule); }
.mb-bh { display: grid; gap: 3px; }
.mb-bt { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.mb-bn { font: 600 13.5px/1.2 var(--font-ui); color: var(--text); }
.mb-br { min-width: 0; overflow: hidden; text-overflow: ellipsis; font: 400 11.5px/1.2 var(--font-mono); color: var(--text-3); white-space: nowrap; }
.mb-nowrow { display: grid; grid-template-columns: minmax(0, 1fr) 76px; align-items: center; gap: 8px; font-size: 11.5px; min-height: 1.25em; }
.mb-now { min-width: 0; font: 400 11.5px/1.25 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mb-nowrow .mb-gr { width: 76px; height: 8px; }
.mb-plot { position: relative; aspect-ratio: 1 / 1; max-height: 236px; margin: 4px 0 4px; touch-action: none; user-select: none; -webkit-user-select: none; }
.mb-plot .mb-pcv { position: absolute; inset: 0; width: 100%; height: 100%; }
/* a threshold: a square on the curve, hollow for the downward one, filled for the upward one */
.mb .mb-h.pk-ctl { position: absolute; display: block; left: 0; top: 0; width: 14px; height: 14px; margin: -7px 0 0 -7px; gap: 0; box-sizing: border-box; background: var(--panel); border: 2px solid var(--text); border-radius: var(--r-press); cursor: ew-resize; touch-action: none; outline: none; z-index: 2; will-change: transform; }
.mb .mb-h.pk-ctl[data-side="up"] { background: var(--text); }
.mb-h.drag { border-color: var(--human); }
.mb-h:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.mb-h[data-edge="left"]::after, .mb-h[data-edge="right"]::after { content: ''; position: absolute; top: 50%; width: 0; height: 0; margin-top: -4px; border: 4px solid transparent; }
.mb-h[data-edge="left"]::after { left: -11px; border-right-color: var(--text-2); }
.mb-h[data-edge="right"]::after { right: -11px; border-left-color: var(--text-2); }
.mb-bsum { display: grid; gap: 1px; margin: 0 0 10px; font: 400 11.5px/1.35 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-2); }
.mb-lg { display: flex; align-items: center; gap: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mb-sq { flex: none; width: 9px; height: 9px; box-sizing: border-box; border: 1.5px solid var(--text-2); border-radius: var(--r-press); }
.mb-sq[data-side="up"] { background: var(--text-2); }
.mb-ctl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 4px; justify-items: center; }
.mb-ctl .pk-knob { min-width: 0; }
.mb-ctl .pk-l { font-size: 11px; }
.mb-about { margin: 0; padding: 10px 18px 14px; border-top: var(--rule); font-size: 12.5px; line-height: 1.5; color: var(--text-3); }
/* a phone: the strip, then depth, then the bands one under another; 44 px to take hold of anything */
.pw-phone .mb-strut { display: none; }
.pw-phone .mb-strip { height: 104px; }
.pw-phone .mb-div.pk-ctl { width: 44px; margin-left: -22px; }
.pw-phone .mb-div::before { left: 21px; }
.pw-phone .mb-div .mb-dg { left: 14px; top: 6px; width: 16px; height: 16px; }
.pw-phone .mb-div-l { left: 32px; font-size: 12px; }
.pw-phone .mb-div[data-flip="1"] .mb-div-l { right: 32px; }
.pw-phone .mb-row { display: block; }
.pw-phone .mb-master { grid-template-columns: auto 1fr; justify-items: start; align-items: center; gap: 8px 16px; padding: 12px; border-bottom: var(--rule); }
.pw-phone .mb-master .mb-depth { grid-row: span 2; }
.pw-phone .mb-dsay { margin: 0; max-width: none; text-align: left; font-size: 12.5px; }
.pw-phone .mb-mrow { grid-column: 2; grid-row: 2; }
.pw-phone .mb-loud { grid-column: 1 / -1; grid-row: 3; justify-items: start; margin: 4px 0; }
.pw-phone .mb-ld { justify-items: start; text-align: left; }
.pw-phone .mb-lus { max-width: none; font-size: 12.5px; }
.pw-phone .mb-ml, .pw-phone .mb-pk { font-size: 12px; }
.pw-phone .mb-nowrow { grid-template-columns: minmax(0, 1fr) 96px; }
.pw-phone .mb-nowrow .mb-gr { width: 96px; }
.pw-phone .mb-mrow { justify-content: flex-start; }
.pw-phone .mb-band { border-left: 0; border-bottom: var(--rule); padding: 12px; }
.pw-phone .mb-plot { max-width: 340px; max-height: none; margin-left: auto; margin-right: auto; }
.pw-phone .mb .mb-h.pk-ctl { width: 18px; height: 18px; margin: -9px 0 0 -9px; }
.pw-phone .mb-h::before { content: ''; position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); }
.pw-phone .mb-bn { font-size: 14px; }
.pw-phone .mb-br, .pw-phone .mb-now, .pw-phone .mb-bsum, .pw-phone .mb-about { font-size: 12.5px; }
.pw-phone .mb-sq { width: 11px; height: 11px; }
.pw-phone .mb-ctl .pk-l { font-size: 12px; }
@media (pointer: coarse) { .mb-h::before { content: ''; position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); } }
`;
