// Sounds for a take: which instruments a new idea is offered on, and what a new track is called (docs/INSTRUMENTS-UX.md,
// sections 1.2 and 3.1). Pure: no DOM, no engine; Node runs it as the browser does.
//
//   SOUND_SETS                                     { hum, played, chords, bass, drums }: each { category, rows, fallbacks },
//                                                  a row { device, preset?, family }. Ids and preset names only (ids are
//                                                  forever); display names come from the registry
//   kindOfTake({ kind, src, notes })               -> 'drums' | 'hum' | 'bass' | 'chords' | 'played'. In this order: a
//                                                  drum take (tapped, beatboxed); a hum, whatever its register (a man's
//                                                  hum round A2 is still a hum, and pitch tracking slips octaves); then
//                                                  from the notes: bass under C3 (median), chords when a third of the
//                                                  notes overlap two others, else played
//   soundsFor(take, { has, current, currentPreset, getDevice }) -> [{ device, preset?, set, family, now? }]
//                                                  four rows, the track's current sound first ("now"), its duplicate in
//                                                  the set dropped (same device and preset); a device `has` says no to
//                                                  (a library device not loaded) is skipped and the set's fallbacks fill
//                                                  in. take: a kindOfTake() result or a take for it
//   familyOf(row, def)                             the row's family word ("Electric piano"), else its blurb's words
//                                                  before ':' (the wavetable presets' blurbs start with their family)
//   genreOf(text)                                  -> 'bass-music' | null: the genre a song's title or a request names
//   GENRE_ROWS[genre][set]                         the rows a genre puts first (its tagged presets), before the set's own
//   newPartFor(kind, project)                      -> { name, device } for a track a take makes: hum Melody, keys Keys,
//                                                  pads / beatbox / drums Drums, then "Melody 2", "Melody 3"

const row = (device, family, preset) => (preset ? { device, preset, family } : { device, family });

export const SOUND_SETS = {
  hum: {
    category: 'keys',
    rows: [
      row('core.keys', 'Electric piano'),
      row('core.wavetable', 'Synth'),
      row('core.strings', 'Strings'),
      row('claude.choir-loft', 'Choir'),
    ],
    fallbacks: [
      row('core.mallets', 'Mallets'),
      row('core.ensemble', 'Strings'),
      row('core.choir', 'Choir'),
      row('core.pluck', 'Pluck'),
      row('core.barisax', 'Sax'),
      row('core.cello', 'Cello'),
      row('core.flute', 'Flute'),
    ],
  },
  played: {
    category: 'keys',
    rows: [
      row('core.keys', 'Electric piano'),
      row('core.upright', 'Upright piano'),
      row('core.wavetable', 'Synth'),
      row('core.mallets', 'Mallets'),
    ],
    fallbacks: [
      row('core.grand', 'Piano'),
      row('core.vibes', 'Vibraphone'),
      row('core.brass', 'Brass'),
      row('core.piano', 'Piano'),
      row('core.pluck', 'Pluck'),
      row('core.eguitar', 'Electric guitar'),
      row('core.trumpet', 'Trumpet'),
    ],
  },
  chords: {
    category: 'keys',
    rows: [
      row('core.keys', 'Electric piano'),
      row('core.upright', 'Upright piano'),
      row('core.pad', 'Pad'),
      row('core.ensemble', 'Strings'),
    ],
    fallbacks: [
      row('core.grand', 'Piano'),
      row('core.strings', 'Strings'),
      row('core.ep', 'Electric piano'),
      row('core.piano', 'Piano'),
      row('core.organ', 'Organ'),
      row('core.poly2', 'Synth'),
    ],
  },
  bass: {
    category: 'bass',
    rows: [
      row('core.ebass', 'Bass guitar'),
      row('core.bass', 'Synth bass'),
      row('claude.sub-basement', 'Sub bass'),
      row('core.wavetable', 'Synth bass', 'Low Key'),
    ],
    fallbacks: [row('core.bassguitar', 'Bass guitar'), row('core.poly2', 'Synth bass', 'Ladder bass')],
  },
  drums: {
    category: 'drums',
    rows: [
      row('core.drums', 'Drum kit', 'Studio kit'),
      row('core.drumkit', 'Jazz kit'),
      row('core.drumroom', 'Acoustic kit'),
      row('core.drums', 'Drum kit', 'Boom bap'),
    ],
    fallbacks: [
      row('core.brushkit', 'Brushes'),
      row('core.handkit', 'Hand percussion'),
      row('core.drums', 'Drum kit', 'Trap'),
      row('core.drums', 'Drum kit', 'Live room'),
    ],
  },
};

// A named genre's sounds, first in the card when the song (its title) or the request names the genre: its tagged
// presets (devices/registry.js PRESET_TAGS), then the set's own rows
export const GENRE_ROWS = {
  'bass-music': {
    bass: [
      row('core.wavetable', 'Sub', 'Dark Slide'),
      row('core.wavetable', 'Growl', 'Fixer'),
      row('core.wavetable', 'Riddim stab', 'Hard Cut'),
      row('core.wavetable', 'Reese', 'Double Exposure'),
      row('core.wavetable', 'Wobble', 'Strobe'),
    ],
    played: [
      row('core.wavetable', 'Lead', 'Key Light'),
      row('core.wavetable', 'Growl', 'Emulsion'),
      row('core.wavetable', 'Supersaw', 'Wide Angle'),
    ],
    hum: [row('core.wavetable', 'Lead', 'Key Light'), row('core.wavetable', 'Growl', 'Emulsion')],
    chords: [row('core.wavetable', 'Supersaw', 'Wide Angle'), row('core.wavetable', 'Pad', 'Long Exposure')],
    drums: [
      row('core.clubkit', 'Club kit', 'Dubstep'),
      row('core.clubkit', 'Club kit', 'Riddim'),
      row('core.clubkit', 'Club kit', 'Drum and bass'),
    ],
  },
};
const GENRE_WORDS = [
  [
    'bass-music',
    /\b(bass music|dubstep|brostep|riddim|tearout|drum ?(?:and|&|n|'n') ?bass|dnb|d&b|neuro(?:funk)?|melodic bass|wobble|growl)\b/i,
  ],
];
export function genreOf(text) {
  const s = String(text || '');
  for (const [g, re] of GENRE_WORDS) if (re.test(s)) return g;
  return null;
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b),
    n = s.length;
  return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN;
};

export function kindOfTake({ kind = null, src = null, notes = [] } = {}) {
  if (kind === 'drums' || src === 'pads' || src === 'tap' || src === 'beatbox') return 'drums';
  if (src === 'hum') return 'hum';
  const ns = (notes || []).filter((n) => n && Number.isFinite(+n.p));
  if (!ns.length) return 'played';
  if (median(ns.map((n) => +n.p)) < 48) return 'bass';
  // chords: at least a third of the notes sound over two others at once
  const over = (a, b) => a.t < b.t + b.d - 1e-6 && b.t < a.t + a.d - 1e-6;
  let full = 0;
  for (const a of ns) {
    let k = 0;
    for (const b of ns) if (b !== a && over(a, b) && ++k >= 2) break;
    if (k >= 2) full++;
  }
  return full * 3 >= ns.length ? 'chords' : 'played';
}

export function familyOf(r, def = null) {
  if (r && r.family) return r.family;
  const pr =
    r && r.preset && def && Array.isArray(def.presets) ? def.presets.find((x) => x && x.name === r.preset) : null;
  const blurb = String((pr && pr.blurb) || (def && def.blurb) || '');
  const i = blurb.indexOf(':');
  return i > 0 && i < 30 ? blurb.slice(0, i).trim() : '';
}

const SETS = Object.keys(SOUND_SETS);
const setOf = (take) =>
  typeof take === 'string' && SETS.includes(take) ? take : kindOfTake(take && typeof take === 'object' ? take : {});
const same = (a, b) => a.device === b.device && (a.preset || null) === (b.preset || null);

export function soundsFor(
  take,
  { has = () => true, current = null, currentPreset = null, getDevice = null, n = 4, genre = null } = {},
) {
  const set = setOf(take),
    S0 = SOUND_SETS[set],
    G = genre && GENRE_ROWS[genre] && GENRE_ROWS[genre][set];
  const S = G ? { ...S0, rows: [...G, ...S0.rows] } : S0;
  const ok = (id) => {
    try {
      return !!has(id);
    } catch {
      return false;
    }
  };
  const def = (id) => {
    try {
      return getDevice ? getDevice(id) : null;
    } catch {
      return null;
    }
  };
  const out = [];
  if (current) {
    const mine = [...S.rows, ...S.fallbacks].find((x) => same(x, { device: current, preset: currentPreset }));
    const now = { device: current, ...(currentPreset ? { preset: currentPreset } : {}), set, now: true };
    now.family = familyOf(mine || now, def(current));
    out.push(now);
  }
  for (const r of [...S.rows, ...S.fallbacks]) {
    if (out.length >= n) break;
    if (!ok(r.device) || out.some((x) => same(x, r))) continue;
    out.push({ ...r, set, family: familyOf(r, def(r.device)) });
  }
  return out;
}

const DEFAULTS = {
  hum: { name: 'Melody', device: 'core.keys' },
  keys: { name: 'Keys', device: 'core.keys' },
  drums: { name: 'Drums', device: 'core.drums' },
};
export function newPartFor(kind, project = null) {
  const k =
    kind === 'pads' || kind === 'beatbox' || kind === 'drums' || kind === 'tap'
      ? 'drums'
      : kind === 'hum'
        ? 'hum'
        : 'keys';
  const base = DEFAULTS[k];
  const names = new Set(
    ((project && project.tracks) || []).map((t) =>
      String(t.name || '')
        .trim()
        .toLowerCase(),
    ),
  );
  let name = base.name;
  for (let i = 2; names.has(name.toLowerCase()); i++) name = `${base.name} ${i}`;
  return { name, device: base.device };
}
