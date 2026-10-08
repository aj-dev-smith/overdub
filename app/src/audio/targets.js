// Genre targets as data: what a finished track in a genre measures, as ranges, so a render can be checked against them
// (render_and_measure's targets, tools/bassmusic-test.js). Pure, Node and the browser.
//
//   TARGETS[genre] = { name, sources, song: { metric: [lo, hi] }, drop: { metric: [lo, hi] }, bands: { band: [lo, hi] },
//                      parts: { part: { metric: [lo, hi] } }, provisional: [metric] }
//   checkTargets(m, genre, { window: 'song' | 'drop' }) -> [{ metric, value, lo, hi, ok, delta }]   misses first
//     m: measure()'s result (audio/measure.js). 'song' checks the whole song's numbers (integrated loudness, true peak,
//     PLR); 'drop' a drop's (its short-term loudness at its loudest, crest, the low end's mono-ness, the bands'
//     balance). delta: how far outside the range it is (0 inside), in the metric's units.
//
// bass-music: dubstep, riddim, melodic bass and drum and bass. The loudness rows come from published numbers:
// commercial dubstep and EDM measure -4.2 to -7.1 LUFS integrated (Peleg, SoundCamps), the "loud" lane is -6 LUFS short
// term at the loudest section (Frampton, Mastering The Mix), a lossy codec wants -1 dBTP at most (AES TD1008), and
// club systems sum the low end to mono (FaderPro; Mastering The Mix: "everything below 120 Hz to mono"). We stop at -6
// LUFS integrated, where a clipper and a limiter written in plain JS start to audibly distort. The crest, PLR and band
// ranges are house starting points, marked provisional: measured references replace them (tools/genre-refs.js).

export const TARGETS = {
  'bass-music': {
    name: 'bass music (dubstep, riddim, melodic bass, drum and bass)',
    sources: ['SoundCamps "Spotify LUFS" (2026)', 'Mastering The Mix "How loud should you master?"', 'AES TD1008 (2021)', 'Spotify for Artists "Loudness normalization"', 'FaderPro "Treating low frequencies for the club"', 'Mastering The Mix "How to mix low-end"'],
    song: { lufs: [-8, -6], truePeak: [-Infinity, -1], plr: [5, 8] },
    drop: { lufsShortMax: [-6, -4], crest: [6, 9], lowSideDb: [-Infinity, -20], lowCorrelation: [0.95, 1] },
    bands: { sub: [-7, -2], low: [-5, -1], lowmid: [-14, -8], mid: [-14, -8], highmid: [-19, -12], presence: [-22, -14], air: [-28, -18] },
    parts: {
      sub: { correlation: [0.999, 1], cleanDb: [-Infinity, -20], fundamentalHz: [30, 65] },
      kick: { peakMs: [0, 5], crest100: [10, Infinity], tailCents: [-25, 25] },
      snare: { peakMs: [0, 5], crest100: [12, Infinity], wiresT60: [0, 0.5], bodyHz: [150, 300] },
      hats: { midGapDb: [-30, 0], topDb: [-6, Infinity], correlation: [-1, 0.5] },
      growl: { talkOctaves: [1, Infinity] },
      reese: { correlationAbove200: [0.2, 0.8], beatingHz: [0.5, 8] },
      level: { lufs: [-18.5, -13.5], truePeak: [-Infinity, -1] },
    },
    provisional: ['plr', 'crest', 'bands'],
  },
};
export const GENRES = Object.keys(TARGETS);

// The words, for the agent and the page: a metric's name and its unit
export const METRIC_WORDS = {
  lufs: ['integrated loudness', 'LUFS'], truePeak: ['true peak', 'dBTP'], plr: ['peak to loudness', 'dB'], lufsShortMax: ['short-term loudness at its loudest', 'LUFS'],
  crest: ['crest factor', 'dB'], lowSideDb: ['side under 120 Hz against the mid', 'dB'], lowCorrelation: ['L/R correlation under 120 Hz', ''],
  sub: ['sub (20-60 Hz) share', 'dB'], low: ['low (60-250 Hz) share', 'dB'], lowmid: ['low-mid (250-500 Hz) share', 'dB'], mid: ['mid (500 Hz-2 kHz) share', 'dB'],
  highmid: ['high-mid (2-4 kHz) share', 'dB'], presence: ['presence (4-8 kHz) share', 'dB'], air: ['air (8 kHz up) share', 'dB'],
};

const r2 = (x) => Math.round(x * 100) / 100;
function row(metric, value, [lo, hi]) {
  const v = Number(value);
  if (!Number.isFinite(v)) return { metric, value: null, lo, hi, ok: false, delta: null };
  const delta = v < lo ? r2(v - lo) : v > hi ? r2(v - hi) : 0;
  return { metric, value: r2(v), lo, hi, ok: delta === 0, delta };
}

// Check a measurement against a genre's targets. Returns rows, the misses first (then in the table's order).
export function checkTargets(m, genre, { window = 'drop' } = {}) {
  const T = TARGETS[genre];
  if (!T) throw new Error(`no targets for "${genre}" (there are: ${GENRES.join(', ')})`);
  if (!m || typeof m !== 'object') throw new Error('checkTargets needs a measurement (audio/measure.js measure())');
  const rows = [];
  if (window === 'song') {
    rows.push(row('lufs', m.lufs, T.song.lufs), row('truePeak', m.truePeak, T.song.truePeak), row('plr', m.truePeak - m.lufs, T.song.plr));
  } else {
    for (const [k, r] of Object.entries(T.drop)) rows.push(row(k, m[k], r));
    for (const [k, r] of Object.entries(T.bands)) rows.push(row(k, m.bands ? m.bands[k] : NaN, r));
  }
  const order = new Map(rows.map((x, i) => [x, i]));
  return rows.sort((a, b) => (a.ok === b.ok ? order.get(a) - order.get(b) : a.ok ? 1 : -1));
}
// Say a row in the house's voice: what, the number, the range ("integrated loudness -7.2 LUFS (want -8 to -6)")
export function targetWords(r) {
  const [w, u] = METRIC_WORDS[r.metric] || [r.metric, ''];
  const n = (x) => (x === Infinity ? 'up' : x === -Infinity ? 'down' : `${x}`);
  const range = r.lo === -Infinity ? `${n(r.hi)} or under` : r.hi === Infinity ? `${n(r.lo)} or over` : `${n(r.lo)} to ${n(r.hi)}`;
  return `${w} ${r.value == null ? 'unmeasured' : r.value}${u ? ' ' + u : ''} (want ${range})${r.ok ? '' : `, ${Math.abs(r.delta)} ${u || ''} ${r.delta > 0 ? 'over' : 'under'}`.replace(/\s+/g, ' ').trimEnd()}`;
}
