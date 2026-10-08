// "Build a band around it": the page side of core/arrange.js. Three ways in, one engine:
//   - the person: Sketch's "Band" button on a kept take, or Shift+B on a selected clip -> a small picker (style,
//     parts) -> one undo step signed 'overdub' (it's a house tool, not an agent) and a toast in the house voice
//   - an agent: the `arrange_around` tool -> one undo step signed by that agent, or two styles as takes for
//     propose_variations (mode "propose")
//   - code: app.band.build({ track, clip, style, parts, seed, by }) -> Promise<{ ok, txn, plan, levels } | { error, hint }>
// Levels are measured, not guessed: before anything lands, the seed and each new part are rendered offline (in a
// scratch copy of the song, through engine/render.js, the same graph the person hears) and every new fader is set so
// that part sits under the seed by its style's margin. Where nothing can render (no Web Audio), the style's
// calibrated faders are used. The seed's notes are never touched: the band only adds tracks.

import { installTools, isRecording } from './tools.js';
import { ARRANGE_SCHEMA } from './extra-schemas.js';
import { planArrangement, STYLES, STYLE_IDS, PARTS, findStyle, balanceGains } from '../core/arrange.js';
import { createStore } from '../core/store.js';
import { beatsPerBar } from '../core/music.js';
import { measure } from '../audio/measure.js';
import { h, css, icon } from '../ui/dom.js';
import { popFocus } from '../ui/arrange-kit.js';

const err = (error, hint, extra) => ({ error, ...(hint ? { hint } : {}), ...(extra || {}) });
const STYLE_KEY = 'overdub:band-style',
  PARTS_KEY = 'overdub:band-parts';
const PAIR = { pop: 'ballad', rock: 'pop', lofi: 'house', house: 'lofi', ballad: 'lofi' }; // the second take's style
const r1 = (x) => Math.round(x * 10) / 10;
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/* ------------------------------------------------------------------------------------------------ the target */
function findTrack(app, ref) {
  if (!ref) return null;
  const p = app.store.get();
  return (
    p.tracks.find((t) => t.id === ref) ||
    p.tracks.find((t) => t.name.toLowerCase() === String(ref).toLowerCase()) ||
    null
  );
}
// { track, clip } from the input, else the person's selected clip.
export function resolveSeed(app, target) {
  const store = app.store,
    sel = app.ui?.state?.selection || {};
  const t = target && typeof target === 'object' ? target : {};
  let track = t.track ? findTrack(app, t.track) : null;
  if (t.track && !track)
    return err(
      `no track "${t.track}"`,
      `tracks: ${store
        .get()
        .tracks.map((x) => `${x.id} "${x.name}"`)
        .join(', ')}`,
    );
  let f = null;
  if (t.clip) {
    f = store.findClip(t.clip);
    if (!f) return err(`no clip "${t.clip}"`, 'get_project lists the clips; get_selection gives the selected one');
  } else if (track) {
    if (sel.clip) {
      const s = store.findClip(sel.clip);
      if (s && s.track.id === track.id) f = s;
    }
    const notes = track.clips.filter((c) => c.kind === 'notes');
    if (!f && notes.length === 1) f = { track, clip: notes[0] };
    if (!f)
      return err(
        `which clip on ${track.name}?`,
        `pass target.clip: ${notes.map((c) => `${c.id} "${c.name || ''}" @${c.start}`).join(', ') || 'it has no notes clips'}`,
      );
  } else if (sel.clip) f = store.findClip(sel.clip);
  if (!f)
    return err(
      'no clip to build around',
      'pass target: { track, clip }, or select a clip with notes (a hum, a riff, chords or a beat)',
    );
  if (f.clip.kind !== 'notes')
    return err(
      `${f.clip.name || 'that clip'} is audio`,
      'the band builds around notes: a hummed, tapped or played take, or a clip someone wrote',
    );
  if (!f.clip.notes.length)
    return err(`${f.clip.name || 'that clip'} has no notes`, 'hum, tap or play something into it first');
  return { track: f.track, clip: f.clip };
}

/* ------------------------------------------------------------------------------------------------ measuring */
// Render the seed and each new part alone (in a scratch copy of the song with the band in it) and read their loudness.
async function measureParts(app, plan, { timeoutMs = 9000 } = {}) {
  if (typeof OfflineAudioContext === 'undefined' || app.engine?.silent) return null;
  const work = (async () => {
    const { renderProject } = await import('../engine/render.js');
    const scratch = createStore(structuredClone(app.store.get()), { getDevice: app.devices?.getDevice });
    const res = scratch.dispatch(plan.ops, { by: 'overdub', label: 'measure' });
    if (!res.ok) return null;
    const p = scratch.get();
    const bpb = beatsPerBar(p.meter);
    const from = plan.start,
      to = plan.start + Math.min(plan.length, 8 * bpb); // eight bars is plenty to read a level
    const ids = [['seed', plan.seed.track], ...plan.tracks.map((t) => [t.part, res.created[t.ref]])];
    const out = {};
    await Promise.all(
      ids.map(async ([k, id]) => {
        const buf = await renderProject(p, { from, to, tracks: [id], tail: 0.5, assets: app.engine?.assets });
        out[k] = { lufs: measure(buf).lufs, gain: p.tracks.find((x) => x.id === id)?.gain ?? 0 };
      }),
    );
    return out;
  })();
  try {
    return await Promise.race([work, new Promise((res) => setTimeout(() => res(null), timeoutMs))]);
  } catch (e) {
    console.warn('overdub band: could not measure, using the calibrated faders', e);
    return null;
  }
}

// Plan, measure, re-plan with the measured faders. -> plan (with .levels: each part's LU against the seed, after)
export async function planBand(app, { track, clip, style = 'pop', parts, seed = 1, measure: doMeasure = true } = {}) {
  const plan0 = planArrangement(app.store.get(), { track, clip, style, parts, seed });
  if (plan0.error) return plan0;
  if (!doMeasure) return { ...plan0, measured: false };
  const m = await measureParts(app, plan0);
  if (!m || !m.seed) return { ...plan0, measured: false };
  const gains = balanceGains({
    style: plan0.style,
    seedLufs: m.seed.lufs,
    parts: Object.fromEntries(plan0.tracks.map((t) => [t.part, m[t.part]])),
  });
  const plan = planArrangement(app.store.get(), { track, clip, style, parts, seed, gains });
  const levels = {};
  for (const t of plan.tracks) {
    const before = m[t.part];
    if (before && before.lufs > -70) levels[t.part] = r1(before.lufs + (t.gain - before.gain) - m.seed.lufs);
  }
  return { ...plan, measured: true, seedLufs: r1(m.seed.lufs), levels };
}

/* ------------------------------------------------------------------------------------------------ building */
export async function buildBand(
  app,
  { track, clip, style = 'pop', parts, seed = 1, by = 'overdub', label, reason, measure: doMeasure = true } = {},
) {
  const sid = findStyle(style);
  if (!sid) return err(`no style "${style}"`, `styles: ${STYLE_IDS.join(', ')}`);
  const tgt = resolveSeed(app, { track, clip });
  if (tgt.error) return tgt;
  const plan = await planBand(app, {
    track: tgt.track.id,
    clip: tgt.clip.id,
    style: sid,
    parts,
    seed,
    measure: doMeasure,
  });
  if (plan.error) return plan;
  if (!plan.ops.length)
    return err(
      'nothing to add',
      plan.skipped.length ? plan.skipped.map((s) => `${s.part}: ${s.why}`).join('; ') : 'pick at least one part',
    );
  // the song may have moved while it measured: the seed must still be there, as it was
  const now = app.store.findClip(tgt.clip.id);
  if (!now) return err('the clip went away while the band was being measured', 'try again');
  const lbl = String(label || `band around ${plan.seed.name} (${STYLES[sid].label.toLowerCase()})`).slice(0, 80);
  const res = app.store.dispatch(plan.ops, {
    by,
    label: lbl,
    reason: reason ? String(reason).slice(0, 300) : plan.summary,
  });
  if (!res.ok) return err(res.error, 'the song changed under it; try again');
  if (res.txn) {
    res.txn.reason = reason ? String(reason).slice(0, 300) : plan.summary;
    app.ui?.emit?.('history:annotate', { txn: res.txn });
  }
  const ids = Object.fromEntries(plan.tracks.map((t) => [t.part, res.created[t.ref]]));
  return {
    ok: true,
    txn: res.txn?.id,
    plan,
    ids,
    clips: Object.fromEntries(plan.tracks.map((t) => [t.part, res.created[t.ref + '_clip']])),
  };
}

// "Band in: chords, bass and drums around your 6 notes. One undo takes it back."
export function bandToast(app, r) {
  const p = r.plan,
    seedClip = app.store.findClip(p.seed.clip)?.clip;
  const whose =
    seedClip && app.store.author(seedClip.by)?.kind === 'human'
      ? 'your'
      : `${app.store.author(seedClip?.by)?.name || 'the'}'s`;
  const what = p.kind === 'drums' ? 'hits' : 'notes';
  return `Band in: ${andList(p.made)} around ${whose} ${p.seed.notes} ${what}. One undo takes it back.`;
}

/* ------------------------------------------------------------------------------------------------ the agent tool */
export const ARRANGE_TOOL = {
  ...ARRANGE_SCHEMA, // name, description, input_schema (extra-schemas.js: Node lists it with no tab open)
  run(input, ctx) {
    return runArrangeTool(ctx.app, ctx.by, input);
  },
};

const parse = (v) => {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch (e) {
      return v;
    }
  }
  return v;
};

async function runArrangeTool(app, by, input) {
  const style = findStyle(input.style || 'pop');
  if (!style) return err(`no style "${input.style}"`, `styles: ${STYLE_IDS.join(', ')}`);
  const target = parse(input.target);
  const tgt = resolveSeed(app, target);
  if (tgt.error) return tgt;
  const parts = Array.isArray(parse(input.parts)) ? parse(input.parts) : undefined;
  const seed = Number.isFinite(Number(input.seed)) ? Number(input.seed) : 1;
  const untouched = `It only adds tracks: the ${tgt.clip.notes.length} notes in ${tgt.track.name} › ${tgt.clip.name || 'clip'} are untouched.`;
  if (input.mode === 'propose') {
    const styles = [style, PAIR[style]];
    const plans = await Promise.all(
      styles.map((s) => planBand(app, { track: tgt.track.id, clip: tgt.clip.id, style: s, parts, seed })),
    );
    const bad = plans.find((p) => p.error);
    if (bad) return err(bad.error, bad.hint);
    return {
      proposal: true,
      applied: false,
      touches_human_notes: false,
      title: `Band around ${tgt.track.name} › ${tgt.clip.name || 'clip'}`.slice(0, 80),
      target: { track: tgt.track.id, clip: tgt.clip.id },
      variations: plans.map((p) => ({
        label: `${STYLES[p.style].label.toLowerCase()} band`,
        ops: p.ops,
        why: p.summary,
      })),
      summary: plans.map((p) => p.summary).join(' / '),
      hint: `Nothing changed. ${untouched} propose_variations({ title, target, variations }) offers the two styles as takes; or call again without mode "propose" to add one.`,
    };
  }
  const r = await buildBand(app, {
    track: tgt.track.id,
    clip: tgt.clip.id,
    style,
    parts,
    seed,
    by,
    label: input.label,
    reason: input.reason,
  });
  if (r.error) return r;
  const p = r.plan;
  try {
    app.presence?.highlight?.(
      { track: r.ids[p.tracks[0].part] },
      `${STYLES[style].label.toLowerCase()} band`,
      by,
      4000,
    );
  } catch (e) {
    /* a nicety */
  }
  return {
    ok: true,
    txn: r.txn,
    style,
    kind: p.kind,
    key: `${p.key.root} ${p.key.scale}`,
    summary: p.summary,
    touches_human_notes: false,
    note: untouched,
    progression: p.progression,
    tracks: p.tracks.map((t) => ({
      part: t.part,
      id: r.ids[t.part],
      clip: r.clips[t.part],
      name: t.name,
      device: t.device,
      gain_db: t.gain,
      notes: t.notes,
      lu_vs_seed: p.levels?.[t.part],
    })),
    measured: p.measured,
    skipped: p.skipped.length ? p.skipped : undefined,
    checks: {
      in_key: !p.check.outOfKey.length,
      strong_beat_rubs: p.check.clashes.length,
      bass_on_roots: !p.check.roots.length,
      drums_on_grid: !p.check.offGrid.length,
      fills_in_bars: p.fills,
    },
    targets: { tracks: Object.values(r.ids), clips: Object.values(r.clips) },
    undo: 'undo (your latest) takes the whole band back in one step',
  };
}

/* ------------------------------------------------------------------------------------------------ the picker */
function readPref(k, def) {
  try {
    const v = JSON.parse(localStorage.getItem(k) || 'null');
    return v ?? def;
  } catch (e) {
    return def;
  }
}
function writePref(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {
    /* storage blocked: fine */
  }
}

function installUI(app) {
  css('band', CSS);
  let pop = null,
    closeT = 0,
    restore = null;
  // focus goes back where it came from (the Band button, the arranger) when the picker closes, like every popover
  const close = () => {
    const back = restore ? restore() : null;
    restore = null;
    if (pop) {
      pop.remove();
      pop = null;
    }
    window.removeEventListener('pointerdown', outside, true);
    back?.();
  };
  const outside = (e) => {
    if (pop && !pop.contains(e.target) && !e.target.closest?.('.band-btn')) close();
  };

  // The picker for one seed: style chips, part toggles, Build. anchor: the element it opens from (or the middle).
  function open(target, anchor = null) {
    close();
    const tgt = resolveSeed(app, target);
    if (tgt.error) {
      app.ui.toast(
        tgt.error === 'no clip to build around'
          ? 'Select a clip with notes first (a hum, a riff, chords or a beat), then build the band.'
          : `${tgt.error}.`,
        { kind: 'bad' },
      );
      return null;
    }
    const kind = /drum/i.test(tgt.track.instrument?.device || '') ? 'drums' : null;
    let style = findStyle(readPref(STYLE_KEY, 'pop')) || 'pop';
    let parts = new Set(readPref(PARTS_KEY, ['chords', 'bass', 'drums']).filter((p) => PARTS.includes(p)));
    if (!parts.size) parts = new Set(['chords', 'bass', 'drums']);
    const blurb = h('p.band-blurb');
    const styles = h('div.band-row', { role: 'radiogroup', 'aria-label': 'Style' });
    const partsRow = h('div.band-row', { role: 'group', 'aria-label': 'Parts' });
    const go = h(
      'button.ew-btn.ew-btn-primary.band-go',
      { onclick: () => build() },
      icon('check', { size: 14 }),
      'Build the band',
    );
    // the styles are one radio group: one tab stop (the checked chip), arrows move and choose
    const pickStyle = (s) => {
      style = s;
      paint();
      styles.querySelector('.on')?.focus();
    };
    styles.addEventListener('keydown', (e) => {
      const i = STYLE_IDS.indexOf(style),
        n = STYLE_IDS.length;
      const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      e.stopPropagation();
      pickStyle(STYLE_IDS[(to + n) % n]);
    });
    function paint() {
      // the chips are drawn again: a focused one hands focus to its new self
      const f = document.activeElement,
        fs = styles.contains(f) ? f.dataset.style : null,
        fp = partsRow.contains(f) ? f.dataset.part : null;
      styles.replaceChildren(
        ...STYLE_IDS.map((s) =>
          h(
            'button.band-chip' + (s === style ? '.on' : ''),
            {
              role: 'radio',
              'aria-checked': String(s === style),
              tabindex: s === style ? 0 : -1,
              title: STYLES[s].blurb,
              dataset: { style: s },
              onclick: () => pickStyle(s),
            },
            STYLES[s].label,
          ),
        ),
      );
      partsRow.replaceChildren(
        ...PARTS.map((p) => {
          const off = kind === 'drums' && p === 'drums';
          return h(
            'button.band-chip.band-part' + (parts.has(p) && !off ? '.on' : ''),
            {
              role: 'checkbox',
              'aria-checked': String(parts.has(p) && !off),
              disabled: off,
              title: off ? 'The take is the beat' : `Add ${p}`,
              dataset: { part: p },
              onclick: () => {
                if (parts.has(p)) parts.delete(p);
                else parts.add(p);
                paint();
              },
            },
            p[0].toUpperCase() + p.slice(1),
          );
        }),
      );
      blurb.textContent = STYLES[style].blurb[0].toUpperCase() + STYLES[style].blurb.slice(1) + '.';
      go.disabled = ![...parts].some((p) => !(kind === 'drums' && p === 'drums'));
      if (fs) styles.querySelector('.on')?.focus();
      else if (fp) [...partsRow.children].find((b) => b.dataset.part === fp)?.focus();
    }
    async function build() {
      go.disabled = true;
      go.lastChild.textContent = 'Building…';
      writePref(STYLE_KEY, style);
      writePref(PARTS_KEY, [...parts]);
      const r = await buildBand(app, {
        track: tgt.track.id,
        clip: tgt.clip.id,
        style,
        parts: PARTS.filter((p) => parts.has(p)),
        by: 'overdub',
      });
      close();
      if (r.error) {
        app.ui.toast(`${r.error}${r.hint ? `: ${r.hint}` : ''}`, { kind: 'bad' });
        return;
      }
      const txn = r.txn;
      app.ui.toast(bandToast(app, r), {
        kind: 'ok',
        ms: 6000,
        action: {
          label: 'Undo',
          run: () => {
            const last = app.store.history[app.store.history.length - 1];
            if (last && last.id === txn) app.store.undo();
            else app.ui.toast('Something else changed since; undo it from History.', { kind: 'bad' });
          },
        },
      });
      app.ui.emit?.('band', { txn, plan: r.plan, ids: r.ids });
      // the new parts into view, flashed once; then the band plays the take back as a song, from the take's first bar
      // (not while recording, and not over a song that's already playing)
      try {
        app.arranger?.show?.(Object.values(r.clips || {}).filter(Boolean), 'overdub');
      } catch (e) {
        /* a nicety */
      }
      const eng = app.engine,
        from = app.store.findClip(tgt.clip.id)?.clip.start;
      if (eng && !eng.playing && !isRecording(app) && Number.isFinite(from)) {
        try {
          await eng.play(from);
        } catch (e) {
          /* no audio yet: the toast still says it's in */
        }
      }
    }
    paint();
    pop = h(
      'div.band-pop',
      {
        role: 'dialog',
        'aria-label': 'Build a band around it',
        onkeydown: (e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        },
      },
      h(
        'div.band-h',
        h('b', 'Build a band around it'),
        h(
          'span.band-seed',
          `${tgt.track.name} › ${tgt.clip.name || 'clip'} · ${tgt.clip.notes.length} ${kind === 'drums' ? 'hits' : 'notes'}`,
        ),
      ),
      h('div.band-l', 'Style'),
      styles,
      blurb,
      h('div.band-l', 'Parts'),
      partsRow,
      h('p.band-note', 'Adds tracks only. Your notes stay as they are.'),
      h('div.band-foot', h('button.ew-btn.ew-btn-small', { onclick: close }, 'Cancel'), go),
    );
    document.body.append(pop);
    const pw = pop.offsetWidth,
      ph = pop.offsetHeight;
    if (anchor && anchor.getBoundingClientRect) {
      const r = anchor.getBoundingClientRect();
      pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pw - 8, r.right - pw))}px`;
      pop.style.top = `${r.top - ph - 6 > 8 ? r.top - ph - 6 : Math.min(window.innerHeight - ph - 8, r.bottom + 6)}px`;
    } else {
      pop.style.left = `${Math.max(8, (window.innerWidth - pw) / 2)}px`;
      pop.style.top = `${Math.max(8, (window.innerHeight - ph) / 2)}px`;
    }
    restore = popFocus(pop, { focus: false });
    (styles.querySelector('.on') || go).focus();
    clearTimeout(closeT);
    closeT = setTimeout(() => window.addEventListener('pointerdown', outside, true), 0);
    return pop;
  }

  // The Sketch button for a kept take (null when its clip is gone or isn't notes).
  function button(target) {
    const f = target?.clip && app.store.findClip(target.clip);
    if (!f || f.clip.kind !== 'notes' || !f.clip.notes.length) return null;
    return h(
      'button.ew-btn.ew-btn-small.band-btn',
      {
        onclick: (e) => open({ track: f.track.id, clip: f.clip.id }, e.currentTarget),
        title: 'Build a band around it: chords, bass and drums on new tracks (Shift+B on a selected clip)',
      },
      icon('drum', { size: 12 }),
      'Band',
    );
  }

  app.ui.keys.add({
    key: 'KeyB',
    mod: 'shift',
    run: () => open(null),
    label: 'Build a band around the selected clip',
    group: 'Edit',
  });
  return { open, close, button };
}

export default function (app) {
  installTools(app).register(ARRANGE_TOOL);
  const ui = app.ui ? installUI(app) : null;
  app.band = {
    STYLES,
    styles: STYLE_IDS,
    parts: PARTS,
    build: (opts) => buildBand(app, opts),
    plan: (opts) => planBand(app, opts),
    toast: (r) => bandToast(app, r),
    open: (target, anchor) => ui?.open(target, anchor),
    close: () => ui?.close(),
    button: (target) => ui?.button(target) ?? null,
  };
}

const CSS = `
.band-pop { position: fixed; z-index: 1001; width: 320px; max-width: calc(100vw - 16px); padding: 12px; border-radius: var(--r-2); background: var(--bg-3); border: 1px solid var(--line-2); box-shadow: var(--shadow-2); display: flex; flex-direction: column; gap: 6px; animation: ew-in .15s var(--ease) both; font-size: 12px; }
.band-h { display: flex; flex-direction: column; gap: 2px; margin-bottom: 2px; }
.band-h b { font-size: 13px; }
.band-seed { color: var(--text-3); font: 11px var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.band-l { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-3); margin-top: 4px; }
.band-row { display: flex; flex-wrap: wrap; gap: 5px; }
.band-chip { height: 26px; padding: 0 10px; border-radius: 99px; border: 1px solid var(--line-2); background: transparent; color: var(--text-2); font-size: 11.5px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: .15s var(--ease); }
.band-chip:hover:not(:disabled) { color: var(--text); border-color: var(--text-3); }
.band-chip.on { color: var(--text); border-color: var(--text-2); background: var(--bg-2); }
.band-chip:disabled { opacity: .45; cursor: default; }
.band-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.band-blurb { margin: 2px 0 0; color: var(--text-2); }
.band-note { margin: 6px 0 0; color: var(--text-3); font-size: 11px; }
.band-foot { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
.sk-idea-act:has(> .band-btn) { flex-wrap: wrap; row-gap: 4px; }   /* Sketch's take card: room for Band without clipping Agent */
`;
