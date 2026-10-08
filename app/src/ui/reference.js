// The Reference tab (bottom region, after the Mixer): a finished song you want yours to sit near. Drop an audio file
// on it (or choose one). It is kept beside the song and never in it: not a track, not in the mix, not in any render
// or export. It is measured once (audio/measure.js: loudness, energy per band, brightness, width, dynamics) and
// shown as a target profile beside your mix's. A/B plays it loudness-matched against the song (turned to your mix's
// integrated LUFS), so your ears compare tone, not level. Agents get compare_to_reference.
//
//   the document: project.reference = { asset, name, sr, channels, duration, profile, by } (op 'reference.set'); the
//   samples live in engine.assets under `asset`, like an audio clip's.
//
//   profileOf(measurement) -> the profile kept in the song (small, JSON)
//   compareProfiles(refProfile, songProfile, { name }) -> { deltas, differences, summary, notes }   (pure: Node too)
//   matchGainDb(songLufs, refLufs) -> dB to turn the reference by so it plays at the song's loudness
//   abMatch(songLufs, refProfile) -> { db, limited }: matchGainDb, held so the reference's true peak stays at or under
//                                    −1 dBTP (it plays straight to the speakers, past the master's soft clip)
//
// app.reference = { set(file | { name, buffer }), clear(), measureMix(), compare(input), ab: { start(side), side(s),
//                   stop(), get state() }, get mix() }

import { h, css, icon, byline } from './dom.js';
import { newId, songEnd, isValidReference } from '../core/project.js';
import { beatsPerBar } from '../core/music.js';
import { glossDeltas } from '../agent/lexicon.js';
import { deltas, installTools } from '../agent/tools.js';
import { COMPARE_SCHEMA, capText } from '../agent/extra-schemas.js';

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const BAND_ORDER = ['sub', 'low', 'lowmid', 'mid', 'highmid', 'presence', 'air'];
const BAND_LABEL = {
  sub: 'Sub',
  low: 'Low',
  lowmid: 'Low-mid',
  mid: 'Mid',
  highmid: 'High-mid',
  presence: 'Presence',
  air: 'Air',
};
const BAND_HZ = {
  sub: '< 60 Hz',
  low: '60–250 Hz',
  lowmid: '250–500 Hz',
  mid: '500 Hz–2 kHz',
  highmid: '2–4 kHz',
  presence: '4–8 kHz',
  air: '> 8 kHz',
};

/* ================================================================ pure */
export function profileOf(m) {
  return {
    lufs: m.lufs,
    lra: m.lra,
    truePeak: m.truePeak,
    peak: m.peak,
    crest: m.crest,
    bands: m.bands ? { ...m.bands } : null,
    centroid: m.centroid,
    correlation: m.correlation ?? m.width ?? 1,
    sideDb: m.sideDb,
    onsetsPerSec: m.onsetsPerSec,
    key: m.key ? `${m.key.root} ${m.key.scale}` : null,
    duration: m.duration,
    channels: m.channels,
    sr: m.sr,
  };
}
export const matchGainDb = (songLufs, refLufs) =>
  Number.isFinite(songLufs) && Number.isFinite(refLufs) && songLufs > -100 && refLufs > -100
    ? Math.max(-40, Math.min(12, r2(songLufs - refLufs)))
    : 0;
// The gain A/B actually uses. A quiet, dynamic reference against a loud mix would want more gain than its peaks have
// room for, and nothing after it would catch them, so the match stops where its true peak reaches −1 dBTP.
export const PEAK_CEILING = -1;
export function abMatch(songLufs, ref) {
  const want = matchGainDb(songLufs, ref?.lufs);
  const tp = ref?.truePeak;
  if (!Number.isFinite(tp) || tp + want <= PEAK_CEILING) return { db: want, limited: false };
  return { db: r2(PEAK_CEILING - tp), limited: true };
}

const signed = (x, unit = '') => {
  const v = r1(x);
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}${unit}`;
};
const num = (x) => {
  const v = r1(x);
  return `${v < 0 ? '−' : ''}${Math.abs(v)}`;
}; // a typographic minus
// The song against the reference, in musician's words. Deltas are song minus reference (tools.js deltas(a, b)).
export function compareProfiles(ref, song, { name = 'the reference', partial = false } = {}) {
  const d = deltas(ref, song);
  const differences = glossDeltas(d, { ref: 'the reference' });
  const parts = [];
  if (Number.isFinite(d.lufs))
    parts.push(
      Math.abs(d.lufs) < 1 ? 'about as loud' : `${Math.abs(r1(d.lufs))} LU ${d.lufs < 0 ? 'quieter' : 'louder'}`,
    );
  if (Number.isFinite(d.centroidPct) && Math.abs(d.centroidPct) >= 8)
    parts.push(`${d.centroidPct < 0 ? 'darker' : 'brighter'} (brightness centre ${signed(d.centroidPct, '%')})`);
  const b = d.bands || {};
  const bottom = Number.isFinite(b.sub) && Number.isFinite(b.low) ? (b.sub + b.low) / 2 : null;
  if (bottom != null && Math.abs(bottom) >= 1.5)
    parts.push(`${bottom > 0 ? 'heavier' : 'lighter'} in the low end (${signed(bottom, ' dB')})`);
  if (Number.isFinite(b.lowmid) && b.lowmid >= 1.5)
    parts.push(`fuller in the low-mids (${signed(b.lowmid, ' dB')}: watch for mud)`);
  if (Number.isFinite(d.width) && Math.abs(d.width) >= 0.06) parts.push(d.width > 0 ? 'narrower' : 'wider');
  if (Number.isFinite(d.crest) && Math.abs(d.crest) >= 1.2)
    parts.push(
      d.crest > 0
        ? `more dynamic (crest ${signed(d.crest, ' dB')})`
        : `more squashed (crest ${signed(d.crest, ' dB')})`,
    );
  const toneSame = parts.length <= 1;
  const summary = toneSame
    ? `Against “${name}”, your ${partial ? 'tracks are' : 'mix is'} ${parts[0] || 'level with it'}, and close in tone: nothing over the thresholds.`
    : `Against “${name}”, your ${partial ? 'tracks are' : 'mix is'} ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
  const notes = [];
  if (Number.isFinite(d.lufs) && d.lufs <= -3)
    notes.push(
      'The reference is probably mastered: match its tone first and leave loudness for the end (a limiter such as Red Line on the master).',
    );
  if (partial)
    notes.push('Only some tracks were rendered: the reference is a full mix, so read the balance with care.');
  if (ref.lufs <= -100) notes.push('The reference measured as silence: replace it.');
  return { deltas: d, differences, summary, notes };
}

/* ================================================================ the page */
export default function (app) {
  const { store, ui, engine } = app;
  css('reference', CSS);
  const P = () => store.get();
  let version = 0; // bumps on every real change, so a mix measurement knows it is stale
  store.on('change', (e) => {
    if (e.kind === 'load' || (e.kind !== 'preview' && !(e.ops || []).every((o) => o?.type === 'reference.set')))
      version++;
  });
  const S = { mix: null, measuring: null, loading: null, ab: null, error: null };
  const views = new Set();
  const refresh = () => {
    for (const v of views) v();
  };
  const toast = (t, kind = 'info', o = {}) => ui.toast?.(t, { kind, ...o });

  async function decode(file) {
    if (app.importers?.decodeAudio) return app.importers.decodeAudio(await file.arrayBuffer());
    const OAC = globalThis.OfflineAudioContext;
    return new OAC({ numberOfChannels: 2, length: 1, sampleRate: engine.ctx?.sampleRate || 48000 }).decodeAudioData(
      await file.arrayBuffer(),
    );
  }
  const loadMeasure = () => import('../audio/measure.js');
  const nextFrame = () => new Promise((r) => setTimeout(r, 30));

  // set(file | { name, buffer }) -> { ok, profile } : decode, measure once, store the samples, one undo step by you
  async function setReference(src, { quiet = false } = {}) {
    const name = src?.name || 'reference';
    S.loading = `Measuring ${name}…`;
    S.error = null;
    refresh();
    try {
      const buf = src?.buffer && typeof src.buffer.getChannelData === 'function' ? src.buffer : await decode(src);
      if (!buf || !buf.length) throw new Error('there is no audio in it');
      await nextFrame();
      const M = await loadMeasure();
      const profile = profileOf(M.measure(buf));
      if (profile.lufs <= -100) throw new Error('it is silent');
      const id = newId('a');
      if (!engine.assets?.put) throw new Error('the audio engine is still loading');
      await engine.assets.put(id, buf);
      const r = store.dispatch(
        {
          type: 'reference.set',
          reference: {
            asset: id,
            name,
            sr: buf.sampleRate,
            channels: buf.numberOfChannels,
            duration: r2(buf.duration),
            profile,
          },
        },
        { by: 'you', label: `reference: ${name}` },
      );
      if (!r.ok) throw new Error(r.error);
      S.loading = null;
      refresh();
      if (!quiet)
        toast(
          `Reference is in: “${name}”, ${fmtTime(buf.duration)}, ${num(profile.lufs)} LUFS. It stays out of your mix and your renders.`,
          'ok',
          { ms: 6000, action: { label: 'Undo', run: () => store.undo() } },
        );
      if (!S.mix || S.mix.version !== version) measureMix().catch(() => {});
      ui.emit('reference', { kind: 'set', name, profile });
      return { ok: true, profile, asset: id };
    } catch (e) {
      S.loading = null;
      S.error = `Couldn’t use ${name} as a reference: ${e.message}. WAV, MP3, M4A and OGG work.`;
      refresh();
      if (!quiet) toast(S.error, 'bad');
      return { ok: false, error: e.message };
    }
  }
  function clearReference() {
    if (!P().reference) return { ok: true };
    abStop();
    const name = P().reference.name;
    const r = store.dispatch(
      { type: 'reference.set', reference: null },
      { by: 'you', label: `remove the reference ${name}` },
    );
    if (r.ok) toast(`Removed the reference “${name}”.`, 'info', { action: { label: 'Undo', run: () => store.undo() } });
    return r;
  }

  // the range and tracks a comparison covers (default: the whole song, every track)
  function scopeOf(input = {}) {
    const p = P(),
      bpb = beatsPerBar(p.meter),
      end = songEnd(p);
    let from = 0,
      to = end;
    if (Array.isArray(input.bars) && input.bars.length) {
      const a = Math.max(1, +input.bars[0] || 1),
        b = Math.max(a, +(input.bars[1] ?? input.bars[0]) || a);
      from = (a - 1) * bpb;
      to = b * bpb;
    } else if (Number.isFinite(input.from) || Number.isFinite(input.to)) {
      from = Math.max(0, +input.from || 0);
      to = Number.isFinite(input.to) && input.to > from ? +input.to : end;
    } else if (input.section) {
      const s = p.sections.find(
        (x) => x.id === input.section || x.name.toLowerCase() === String(input.section).toLowerCase(),
      );
      if (!s)
        return {
          error: `no section "${input.section}"`,
          hint: `sections: ${p.sections.map((x) => x.name).join(', ') || 'none'}`,
        };
      from = s.start;
      to = s.start + s.length;
    }
    let ids = null;
    if (Array.isArray(input.tracks) && input.tracks.length) {
      ids = [];
      for (const x of input.tracks) {
        const t =
          p.tracks.find((tt) => tt.id === x) ||
          p.tracks.find((tt) => tt.name.toLowerCase() === String(x).toLowerCase());
        if (!t)
          return {
            error: `no track "${x}"`,
            hint: `tracks: ${p.tracks.map((tt) => `${tt.id} "${tt.name}"`).join(', ') || 'none'}`,
          };
        ids.push(t.id);
      }
    }
    const bars = `bars ${Math.floor(from / bpb) + 1}–${Math.max(Math.floor(from / bpb) + 1, Math.ceil(to / bpb))}`;
    const whole = from === 0 && to === end && !ids;
    return {
      from,
      to,
      ids,
      whole,
      label: `${ids ? ids.map((id) => p.tracks.find((t) => t.id === id)?.name).join(' + ') : 'the mix'} · ${whole ? 'the whole song' : bars}`,
    };
  }
  async function renderProfile(sc, signal) {
    if (!engine || engine.silent) throw new Error('the audio engine is not loaded, so nothing can be rendered');
    const buf = await engine.render({ from: sc.from, to: sc.to, tracks: sc.ids, tail: 1 });
    if (signal?.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
    const M = await loadMeasure();
    return profileOf(M.measure(buf));
  }
  // the whole mix, measured: what the profile sits beside and what A/B matches loudness to
  async function measureMix() {
    if (S.measuring) return S.measuring;
    const v = version;
    S.measuring = (async () => {
      refresh();
      try {
        const profile = await renderProfile(scopeOf({}));
        S.mix = { profile, version: v, at: Date.now() };
        if (S.ab) setMatch();
        return S.mix;
      } finally {
        S.measuring = null;
        refresh();
      }
    })();
    return S.measuring;
  }

  // compare_to_reference (also what the tab's "Compare" uses)
  async function compare(input = {}, { signal } = {}) {
    const ref = P().reference;
    if (!isValidReference(ref))
      return {
        error: 'there is no reference track yet',
        hint: 'ask the human to drop a finished song they want theirs to sit near on the Reference tab (bottom panel); it stays out of the mix',
      };
    const sc = scopeOf(input);
    if (sc.error) return sc;
    let prof;
    try {
      prof = await renderProfile(sc, signal);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      return { error: `could not render: ${e.message}`, hint: 'check the range and tracks' };
    }
    if (sc.whole) {
      S.mix = { profile: prof, version, at: Date.now() };
      if (S.ab) setMatch();
      refresh();
    }
    const refName = capText(ref.name, 80); // a file name from whoever made the song: content, trimmed
    const cmp = compareProfiles(ref.profile, prof, { name: refName, partial: !!sc.ids });
    const compact = (x) => ({
      lufs: x.lufs,
      truePeak: x.truePeak,
      crest: x.crest,
      lra: x.lra,
      bands: x.bands,
      centroid: Math.round(x.centroid || 0),
      correlation: x.correlation,
      onsetsPerSec: x.onsetsPerSec,
      key: x.key,
    });
    return {
      reference: refName,
      scope: sc.label,
      summary: cmp.summary,
      differences: cmp.differences.length ? cmp.differences : ['no perceptible difference from the reference'],
      deltas: cmp.deltas,
      song: compact(prof),
      reference_profile: compact(ref.profile),
      ab_match: abMatchLine(abMatch(prof.lufs, ref.profile), 'A/B plays the reference', 'to match this loudness'),
      ...(cmp.notes.length ? { notes: cmp.notes } : {}),
    };
  }

  /* ---------------------------------------------------------------- A/B */
  // The song keeps playing through the engine; the reference plays beside it on its own source, straight to the
  // speakers (never through the master: not in masterTap, a render or an export). Switching is a 20 ms crossfade.
  function setMatch() {
    const ab = S.ab,
      ref = P().reference;
    if (!ab || !isValidReference(ref)) return;
    const m = S.mix ? abMatch(S.mix.profile.lufs, ref.profile) : { db: 0, limited: false };
    ab.gainDb = m.db;
    ab.limited = m.limited;
    const c = engine.ctx;
    ab.match.gain.setTargetAtTime(Math.pow(10, ab.gainDb / 20), c.currentTime, 0.02);
  }
  function setSide(side) {
    const ab = S.ab;
    if (!ab) return;
    ab.side = side === 'A' ? 'A' : 'B';
    const c = engine.ctx,
      t = c.currentTime;
    ab.gA.gain.setTargetAtTime(ab.side === 'A' ? 1 : 0, t, 0.006);
    ab.gB.gain.setTargetAtTime(ab.side === 'B' ? 1 : 0, t, 0.006);
    refresh();
  }
  async function abStart(side = 'B') {
    const ref = P().reference;
    if (!isValidReference(ref)) return { ok: false, error: 'no reference' };
    if (S.ab) {
      setSide(side);
      return { ok: true, side };
    }
    if (app.input?.recording || app.engine?.recording) {
      toast('A/B waits until you stop recording.', 'bad');
      return { ok: false, error: 'recording' };
    }
    try {
      await engine.start();
    } catch (e) {
      toast('Audio could not start: ' + e.message, 'bad');
      return { ok: false, error: e.message };
    }
    const c = engine.ctx;
    const buf = await engine.assets.get(ref.asset);
    if (!buf) {
      toast('The reference’s audio isn’t in this browser. Drop the file on the Reference tab again.', 'bad');
      return { ok: false, error: 'the reference audio is missing' };
    }
    if (!S.mix || S.mix.version !== version) {
      try {
        await measureMix();
      } catch (e) {
        /* A/B at unity, said below */
      }
    }
    if (S.ab) {
      setSide(side);
      return { ok: true, side };
    }
    const mon = engine._monitor || null; // the speakers' feed of the mix (master fader → monitor soft clip)
    const gA = c.createGain(),
      gB = c.createGain(),
      match = c.createGain();
    gA.gain.value = side === 'A' ? 1 : 0;
    gB.gain.value = side === 'B' ? 1 : 0;
    if (mon) {
      try {
        mon.disconnect(c.destination);
      } catch (e) {
        /* not wired there */
      }
      mon.connect(gA);
    }
    gA.connect(c.destination);
    match.connect(gB);
    gB.connect(c.destination);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(match);
    if (!engine.playing) engine.play();
    const offset = ((engine.beatToSec(Math.max(0, engine.beat || 0)) % buf.duration) + buf.duration) % buf.duration;
    src.start(c.currentTime + 0.06, offset);
    const m = S.mix ? abMatch(S.mix.profile.lufs, ref.profile) : { db: 0, limited: false };
    match.gain.value = Math.pow(10, m.db / 20);
    S.ab = { side, src, gA, gB, match, mon, gainDb: m.db, limited: m.limited, off: null };
    S.ab.off = engine.on('transport', (e) => {
      if (e && e.playing === false) abStop();
    });
    setSide(side);
    if (!S.mix) toast('A/B is at the reference’s own level: your mix couldn’t be measured to match it.', 'bad');
    return { ok: true, side, gainDb: S.ab.gainDb, limited: S.ab.limited };
  }
  function abStop() {
    const ab = S.ab;
    if (!ab) return;
    S.ab = null;
    try {
      ab.off?.();
    } catch (e) {
      /* gone */
    }
    const c = engine.ctx;
    try {
      ab.src.stop();
    } catch (e) {
      /* not started */
    }
    for (const n of [ab.src, ab.match, ab.gB]) {
      try {
        n.disconnect();
      } catch (e) {
        /* ok */
      }
    }
    if (ab.mon) {
      try {
        ab.mon.disconnect(ab.gA);
      } catch (e) {
        /* ok */
      }
      try {
        ab.mon.connect(c.destination);
      } catch (e) {
        /* ok */
      }
    }
    try {
      ab.gA.disconnect();
    } catch (e) {
      /* ok */
    }
    refresh();
  }
  // a new song or a removed reference ends A/B
  store.on('change', (e) => {
    if (S.ab && (e.kind === 'load' || !P().reference)) abStop();
    if (e.kind === 'load') S.mix = null;
  });

  function pick() {
    const inp = h('input', {
      type: 'file',
      accept: 'audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aif,.aiff',
      style: { display: 'none' },
    });
    inp.addEventListener('change', () => {
      const f = inp.files?.[0];
      inp.remove();
      if (f) setReference(f);
    });
    document.body.append(inp);
    inp.click();
  }

  app.reference = {
    set: setReference,
    clear: clearReference,
    measureMix,
    compare,
    pick,
    profileOf,
    compareProfiles,
    matchGainDb,
    abMatch,
    ab: {
      start: abStart,
      stop: abStop,
      side: setSide,
      get state() {
        return S.ab ? { side: S.ab.side, gainDb: S.ab.gainDb, limited: !!S.ab.limited } : null;
      },
    },
    get mix() {
      return S.mix;
    },
  };

  /* ---------------------------------------------------------------- the agent's tool */
  const TOOL = {
    ...COMPARE_SCHEMA, // name, description, input_schema (agent/extra-schemas.js: Node lists it with no tab open)
    run: (input, ctx) => compare(input, { signal: ctx?.signal }),
  };
  try {
    installTools(app).register(TOOL);
  } catch (e) {
    console.warn('compare_to_reference tool', e.message);
  }

  /* ---------------------------------------------------------------- the tab */
  ui.panel({
    id: 'reference',
    region: 'bottom',
    title: 'Reference',
    icon: 'wave',
    order: 32,
    mount(el) {
      const root = h('div.rf', { role: 'region', 'aria-label': 'Reference track' });
      el.append(root);
      let sig = '';
      let over = 0;
      const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
      root.addEventListener('dragenter', (e) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        over++;
        root.classList.add('rf-over');
      });
      root.addEventListener('dragover', (e) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      });
      root.addEventListener('dragleave', (e) => {
        if (!isFiles(e)) return;
        if (--over <= 0) {
          over = 0;
          root.classList.remove('rf-over');
        }
      });
      root.addEventListener('drop', (e) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        over = 0;
        root.classList.remove('rf-over');
        const f = [...(e.dataTransfer.files || [])].find(
          (x) =>
            /^audio\//.test(x.type || '') ||
            /\.(wav|wave|mp3|m4a|mp4|aac|ogg|oga|opus|flac|aif|aiff|webm)$/i.test(x.name || ''),
        );
        if (f) setReference(f);
        else toast('The Reference tab takes an audio file: WAV, MP3, M4A or OGG.', 'bad');
      });

      function draw() {
        const ref = P().reference;
        const stale = S.mix && S.mix.version !== version;
        const s = JSON.stringify([
          ref && [ref.asset, ref.name, isValidReference(ref)],
          S.mix?.at,
          stale,
          !!S.measuring,
          S.loading,
          S.error,
          S.ab && [S.ab.side, S.ab.gainDb],
        ]);
        if (s === sig) return;
        sig = s;
        if (!ref) {
          root.replaceChildren(empty());
          return;
        }
        // one that came in without its measurement (a hand-made file, an older link) can't be drawn or played: say so,
        // and keep Remove in reach
        if (!isValidReference(ref)) {
          root.replaceChildren(empty(ref));
          return;
        }
        root.replaceChildren(head(ref, stale), body(ref, stale));
      }
      function empty(broken = null) {
        const name = broken && typeof broken.name === 'string' && broken.name ? broken.name : 'the reference';
        return h(
          'div.rf-empty',
          h(
            'div.rf-drop',
            h(
              'b',
              S.loading ||
                (broken ? `“${name}” came without its measurement.` : 'Drop a finished song here to compare against.'),
            ),
            h(
              'span',
              broken
                ? 'Drop the file here again to measure it, or remove it.'
                : 'It stays out of your mix and your renders. It’s measured once, then shown beside your mix, and A/B plays it at your mix’s loudness.',
            ),
            S.error ? h('span.rf-err', S.error) : null,
            h(
              'div.rf-drop-acts',
              h(
                'button.ew-btn.ew-btn-small',
                { type: 'button', onclick: pick, disabled: !!S.loading },
                'Choose a file…',
              ),
              broken
                ? h(
                    'button.ew-btn.ew-btn-small.rf-remove',
                    { type: 'button', onclick: clearReference, title: 'Remove the reference (Undo brings it back)' },
                    'Remove',
                  )
                : null,
            ),
          ),
        );
      }
      function head(ref, stale) {
        const ab = S.ab;
        const sideBtn = (k, label) =>
          h(
            `button.rf-ab-b${ab && ab.side === k ? '.on' : ''}`,
            {
              type: 'button',
              'aria-pressed': String(!!ab && ab.side === k),
              title: k === 'A' ? 'Hear your mix' : 'Hear the reference, loudness-matched to your mix',
              onclick: () => (ab ? setSide(k) : abStart(k)),
            },
            h('b', k),
            h('span', label),
          );
        const match = ab
          ? abMatchLine({ db: ab.gainDb, limited: ab.limited }, 'B', 'to match')
          : S.mix
            ? abMatchLine(abMatch(S.mix.profile.lufs, ref.profile), 'B plays', 'to match')
            : '';
        return h(
          'div.rf-head',
          h(
            'div.rf-id',
            h(
              'b',
              { title: ref.name },
              ref.name,
              byline(ref.by, { app }) ? h('span.rf-by', ', added by ', byline(ref.by, { app })) : null,
            ),
            h('small', `${fmtTime(ref.duration)}, ${num(ref.profile.lufs)} LUFS, not in the mix`),
          ),
          h(
            'div.rf-ab',
            { role: 'group', 'aria-label': 'A/B' },
            sideBtn('A', 'Your mix'),
            sideBtn('B', 'Reference'),
            ab ? h('button.ew-btn.ew-btn-small', { type: 'button', onclick: abStop }, 'Stop') : null,
            match ? h('small.rf-match', match) : null,
          ),
          h(
            'div.rf-acts',
            h(
              'button.ew-btn.ew-btn-small',
              {
                type: 'button',
                disabled: !!S.measuring,
                onclick: () => measureMix().catch((e) => toast(`Couldn’t measure the mix: ${e.message}`, 'bad')),
              },
              S.measuring ? 'Measuring…' : S.mix && !stale ? 'Measure again' : 'Measure the mix',
            ),
            h(
              'button.ew-btn.ew-btn-small',
              { type: 'button', onclick: pick, title: 'Use another file as the reference' },
              'Replace…',
            ),
            h(
              'button.ew-btn.ew-btn-small',
              { type: 'button', onclick: clearReference, title: 'Remove the reference (Undo brings it back)' },
              'Remove',
            ),
          ),
        );
      }
      function body(ref, stale) {
        const rp = ref.profile,
          mp = S.mix?.profile || null;
        const rows = [];
        const legend = h(
          'div.rf-legend',
          h('span', h('i.rf-sw.rf-sw-mix'), 'Your mix'),
          h('span', h('i.rf-sw.rf-sw-ref'), 'Reference'),
          stale ? h('em', 'the song changed since it was measured') : null,
        );
        const bar = (v, cls) =>
          h('i.' + cls, { style: { width: `${Math.max(1, Math.min(100, ((v + 36) / 36) * 100))}%` } });
        for (const k of BAND_ORDER) {
          const rv = rp.bands?.[k] ?? -120,
            mv = mp?.bands?.[k];
          const dv = mv != null ? mv - rv : null;
          rows.push(
            h(
              'div.rf-row',
              { title: BAND_HZ[k] },
              h('span.rf-k', BAND_LABEL[k]),
              h('span.rf-bars', mp ? bar(mv, 'rf-b-mix') : h('i.rf-b-none'), bar(rv, 'rf-b-ref')),
              h('span.rf-d' + (dv != null && Math.abs(dv) >= 1.5 ? '.big' : ''), dv == null ? '' : signed(dv, ' dB')),
            ),
          );
        }
        const stat = (label, mv, rv, fmt, dfmt) => {
          const m = Number.isFinite(mv),
            r = Number.isFinite(rv);
          return h(
            'div.rf-stat',
            h('span.rf-k', label),
            h('b', m ? fmt(mv) : '—'),
            h('span.rf-vs', r ? fmt(rv) : '—'),
            h('span.rf-d', m && r ? dfmt(mv, rv) : ''),
          );
        };
        const stats = h(
          'div.rf-stats',
          h('div.rf-stat.rf-stat-h', h('span'), h('span', 'Mix'), h('span', 'Ref'), h('span', 'Δ')),
          stat(
            'Loudness',
            mp?.lufs,
            rp.lufs,
            (v) => `${num(v)} LUFS`,
            (m, r) => `${signed(m - r, ' LU')}`,
          ),
          stat(
            'Brightness',
            mp?.centroid,
            rp.centroid,
            (v) => (v >= 1000 ? `${r1(v / 1000)} kHz` : `${Math.round(v)} Hz`),
            (m, r) => (r > 0 ? signed((m / r - 1) * 100, '%') : ''),
          ),
          stat(
            'Width',
            mp?.correlation,
            rp.correlation,
            (v) => (v > 0.95 ? 'mono' : v < 0.3 ? 'very wide' : `corr ${r2(v)}`),
            (m, r) => signed(m - r),
          ),
          stat(
            'Dynamics',
            mp?.crest,
            rp.crest,
            (v) => `crest ${num(v)} dB`,
            (m, r) => signed(m - r, ' dB'),
          ),
          stat(
            'Peak',
            mp?.truePeak,
            rp.truePeak,
            (v) => `${num(v)} dBTP`,
            (m, r) => signed(m - r, ' dB'),
          ),
        );
        let words = null;
        if (mp) {
          const cmp = compareProfiles(rp, mp, { name: ref.name });
          words = h(
            'div.rf-words',
            h('p.rf-sum', cmp.summary),
            cmp.differences.length
              ? h(
                  'ul',
                  cmp.differences.slice(0, 6).map((x) => h('li', x)),
                )
              : null,
            cmp.notes.map((x) => h('p.rf-note', x)),
          );
        } else
          words = h(
            'div.rf-words',
            h('p.rf-sum', S.measuring ? 'Measuring your mix…' : 'Measure the mix to see it beside the reference.'),
          );
        return h('div.rf-body', h('div.rf-prof', legend, h('div.rf-bands', rows), stats), words);
      }

      views.add(draw);
      draw();
      return {
        update: draw,
        refresh: () => {
          sig = '';
          draw();
        },
        unmount() {
          views.delete(draw);
        },
      };
    },
  });

  return app.reference;
}

function abMatchLine(m, before, after) {
  return `${before} ${signed(m.db, ' dB')} ${after}${m.limited ? ' (peak-limited)' : ''}`;
}

function fmtTime(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60),
    ss = Math.round(s % 60);
  return m ? `${m}:${String(ss === 60 ? 59 : ss).padStart(2, '0')}` : `${r1(s)} s`;
}

const CSS = `
.rf { height: 100%; overflow: auto; padding: 10px 14px 14px; box-sizing: border-box; color: var(--text); font: 12px/1.4 var(--font-ui); }
.rf.rf-over { outline: 2px dashed var(--accent-2); outline-offset: -6px; background: var(--bg-3); }
.rf-empty { height: 100%; display: grid; place-items: center; }
.rf-drop { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; max-width: 460px; padding: 20px 22px; border: 1px dashed var(--line-2); color: var(--text-2); line-height: 1.5; }
.rf-drop b { color: var(--text); font-size: 13px; }
.rf-drop span { color: var(--text-3); }
.rf-err { color: var(--bad) !important; }
.rf-drop-acts { display: flex; gap: 6px; }
.rf-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
.rf-id { display: grid; min-width: 0; max-width: 420px; }
.rf-by { font-weight: 400; color: var(--text-3); }
.rf-id b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
.rf-id small { color: var(--text-3); }
.rf-ab { display: flex; align-items: center; gap: 6px; }
.rf-ab-b { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: var(--r-2); border: 1px solid var(--line-2); background: var(--bg-3); color: var(--text-2); cursor: pointer; font: 600 11px var(--font-ui); }
.rf-ab-b b { font: 700 13px var(--font-mono); color: var(--text); }
.rf-ab-b.on, .rf-ab-b.on b { background: var(--text); border-color: var(--text); color: var(--bg); }
.rf-ab-b:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.rf-match { color: var(--text-3); font-family: var(--font-mono); }
.rf-acts { display: flex; gap: 6px; margin-left: auto; }
.rf-body { display: grid; grid-template-columns: minmax(300px, 1.2fr) minmax(220px, 1fr); gap: 18px; }
.rf-legend { display: flex; gap: 14px; align-items: center; color: var(--text-3); margin-bottom: 6px; }
.rf-legend span { display: inline-flex; align-items: center; gap: 6px; }
.rf-legend em { color: var(--warn); font-style: normal; }
.rf-sw { width: 14px; height: 7px; border-radius: 2px; display: inline-block; }
.rf-sw-mix, .rf-b-mix { background: var(--text-2); }
.rf-sw-ref, .rf-b-ref { background: repeating-linear-gradient(135deg, var(--c-8) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--c-8); }
.rf-row { display: grid; grid-template-columns: 70px 1fr 64px; align-items: center; gap: 8px; height: 22px; }
.rf-k { color: var(--text-2); }
.rf-bars { display: flex; flex-direction: column; gap: 2px; }
.rf-bars i { display: block; height: 6px; border-radius: 2px; }
.rf-b-none { height: 6px; }
.rf-d { font-family: var(--font-mono); color: var(--text-3); text-align: right; font-size: 11px; }
.rf-d.big { color: var(--text); }
.rf-stats { margin-top: 10px; display: grid; gap: 2px; }
.rf-stat { display: grid; grid-template-columns: 70px 1fr 1fr 64px; gap: 8px; align-items: baseline; font-family: var(--font-mono); font-size: 11px; }
.rf-stat .rf-k { font-family: var(--font-ui); font-size: 12px; }
.rf-stat b { font-weight: 600; }
.rf-vs { color: var(--text-3); }
.rf-stat-h { color: var(--text-3); font-family: var(--font-ui); }
.rf-words { color: var(--text-2); }
.rf-sum { color: var(--text); font-size: 13px; margin: 0 0 8px; }
.rf-words ul { margin: 0 0 8px; padding-left: 16px; }
.rf-words li { margin: 2px 0; }
.rf-note { color: var(--text-3); margin: 4px 0 0; }
@media (max-width: 760px) { .rf-body { grid-template-columns: 1fr; } .rf-acts { margin-left: 0; } }
`;
