// The sample-library QA rubric's automatic checks (the pipeline report's section 2), as tools/fetch-kits.js runs them
// on every sample of a melodic kit after decoding and before any processing. Each check gives each sample 'accept',
// 'review' or 'reject' with its numbers, and the instrument a verdict: the rubric's rule is to reject the source, not
// the sample, so a check fails the instrument only when more than 10% of its samples are rejected (fewer are named,
// for the listening room). A recipe can waive a check with a written reason. Zero dependencies, plain arithmetic.
//
//   qaSample({ ch: [Int32Array, ...], bits, sr }, { key, looped, tuning })  -> the numbers for one sample (tuning:
//                                                    false for a drum: no pitch is read)
//   qaInstrument(rows, waive, { drums })                            -> { verdicts: [[check, verdict, why]], rows }
//                                                    drums: a kit's rows ({ id, key: the piece, layer, rr, hash, qa }):
//                                                    no tuning checks; check 15 reads the round robins instead
//   pitchAt(x, sr, from, len, f0)                -> { cents, amp, edge }: the strongest peak within 100 cents of f0
const dbfs = (x, full) => (x > 0 ? 20 * Math.log10(x / full) : -200);

// the amplitude of frequency f in x[from .. from + len] (a Hann-windowed single-bin DFT)
function bin(x, sr, from, len, f) {
  let re = 0, im = 0;
  const w = 2 * Math.PI * f / sr;
  for (let i = 0; i < len; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / len), v = x[from + i] * h; re += v * Math.cos(w * i); im += v * Math.sin(w * i); }
  return Math.hypot(re, im);
}
// The tuning of a note: the frequency of the strongest spectral peak within 100 cents of its nominal fundamental (a
// 2-cent search, then 0.1-cent around the best). A piano's partials are stretched, so its fundamental is read
// directly rather than from the period of the whole waveform (which a strong second partial pulls).
export function pitchAt(x, sr, from, len, f0) {
  let best = 0, bv = -1;
  for (let c = -100; c <= 100; c += 2) { const v = bin(x, sr, from, len, f0 * Math.pow(2, c / 1200)); if (v > bv) { bv = v; best = c; } }
  const c0 = best;
  for (let c = c0 - 2; c <= c0 + 2; c += 0.1) { const v = bin(x, sr, from, len, f0 * Math.pow(2, c / 1200)); if (v > bv) { bv = v; best = c; } }
  return { cents: best, edge: Math.abs(c0) >= 100, amp: bv };
}

export function qaSample({ ch, bits, sr }, { key, looped = false, tuning = true }) {
  const full = 2 ** (bits - 1), [L, R] = [ch[0], ch[1] || ch[0]], n = L.length;
  // 2. clipping: runs of 3 or more samples at or above -0.1 dBFS, and flat tops (3 or more equal samples up there)
  const clipAt = full * Math.pow(10, -0.1 / 20);
  let runs = 0, flat = 0, peak = 0;
  for (const x of [L, R]) {
    let r = 0, f = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(x[i]); if (a > peak) peak = a;
      if (a >= clipAt) { if (++r === 3) runs++; if (i > 0 && x[i] === x[i - 1]) { if (++f === 2) flat++; } else f = 0; } else { r = 0; f = 0; }
    }
  }
  // 3. DC: each channel's mean
  let dc = -200;
  for (const x of [L, R]) { let s = 0; for (let i = 0; i < n; i++) s += x[i]; dc = Math.max(dc, dbfs(Math.abs(s / n), full)); }
  // 4 and 8. floor and SNR: the quietest and loudest 10 ms RMS (windows of digital zero skipped); the tail: the last
  // 10 ms against the loudest. A looped sample stops on its loop, so it has neither a floor nor a tail to read.
  const W = Math.round(0.01 * sr);
  let lo = Infinity, hi = 0, last = 0;
  for (let a = 0; a + W <= n; a += W) {
    let e = 0; for (let i = a; i < a + W; i++) e += (L[i] * L[i] + R[i] * R[i]) / 2;
    const r = Math.sqrt(e / W);
    if (r > hi) hi = r;
    if (r > 0 && r < lo) lo = r;
    last = r;
  }
  // 7. head: the onset (the first sample within 20 dB of the peak) and the level of the first sample
  let on = 0; while (on < n && Math.abs(L[on]) * 10 < peak && Math.abs(R[on]) * 10 < peak) on++;
  const first = dbfs(Math.max(Math.abs(L[0]), Math.abs(R[0])), full);
  // 9 and 10. the attack's level: RMS of the 150 ms from the onset
  const A = Math.min(n - on, Math.round(0.15 * sr));
  let ea = 0; for (let i = on; i < on + A; i++) ea += (L[i] * L[i] + R[i] * R[i]) / 2;
  const attack = dbfs(Math.sqrt(ea / Math.max(1, A)), full);
  // 11. tuning: on the mono sum, two half-second windows from 0.5 s and 1.0 s after the onset (a short note: two
  // overlapping windows in what there is, after its first 50 ms)
  const f0 = 440 * Math.pow(2, (key - 69) / 12), mono = new Float64Array(n);
  for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) / 2;
  let wins;
  const half = Math.round(0.5 * sr);
  if (on + Math.round(1.5 * sr) <= n) wins = [on + Math.round(0.5 * sr), on + Math.round(1.0 * sr)].map((a) => [a, half]);
  else { const a = on + Math.round(0.05 * sr), len = Math.floor((n - a) * 0.6); wins = [[a, len], [n - len, len]]; }
  const t = wins.map(([a, len]) => (tuning && len > 4 * sr / f0 ? pitchAt(mono, sr, a, len, f0) : null));
  // 12. L/R correlation over the first 300 ms, and what summing to mono costs there (dB against the stereo level)
  const C = Math.min(n - on, Math.round(0.3 * sr));
  let lr = 0, ll = 0, rr = 0; for (let i = on; i < on + C; i++) { lr += L[i] * R[i]; ll += L[i] * L[i]; rr += R[i] * R[i]; }
  const corr = lr / Math.sqrt(ll * rr || 1);
  return {
    looped, peak: +dbfs(peak, full).toFixed(2), clipRuns: runs, flatTops: flat, dc: +dc.toFixed(1),
    floor: looped ? null : +dbfs(lo, full).toFixed(1), snr: looped ? null : +(dbfs(hi, full) - dbfs(lo, full)).toFixed(1),
    onset: on, first: +first.toFixed(1), tail: looped ? null : +(dbfs(last, full) - dbfs(hi, full)).toFixed(1),
    attack: +attack.toFixed(2),
    cents: t.map((x) => (x && !x.edge ? +x.cents.toFixed(1) : null)),
    corr: +corr.toFixed(2), monoLoss: +(10 * Math.log10((ll + rr + 2 * lr) / (2 * (ll + rr)) || 1e-20)).toFixed(1),
  };
}

// each check's verdict for one sample: [verdict, short reason] ('accept' | 'review' | 'reject'), or null (not read)
const CHECKS = {
  '2 clipping': (q) => (q.flatTops ? ['reject', `${q.flatTops} flat tops`] : q.clipRuns ? ['review', `${q.clipRuns} runs of 3+ samples at -0.1 dBFS or above, none flat (a peak-normalized crest)`] : ['accept', '']),
  '3 DC offset': (q) => (q.dc <= -60 ? ['accept', ''] : q.dc <= -40 ? ['review', `${q.dc} dBFS`] : ['reject', `${q.dc} dBFS`]),
  '4 noise floor and SNR': (q) => (q.snr == null ? null : q.snr >= 65 ? ['accept', ''] : q.snr >= 55 ? ['review', `SNR ${q.snr} dB`] : ['reject', `SNR ${q.snr} dB`]),
  '7 head': (q) => (q.onset === 0 && q.first > -30 ? ['reject', 'attack cut off'] : ['accept', '']),
  '8 tail': (q) => (q.tail == null ? null : q.tail <= -70 ? ['accept', ''] : q.tail <= -55 ? ['review', `ends ${q.tail} dB under its loudest (faded at build)`] : ['reject', `stops ${q.tail} dB under its loudest`]),
  '11 tuning': (q) => {
    const [a, b] = q.cents;
    if (a == null || b == null) return ['review', 'no fundamental within 100 cents to read'];
    if (Math.abs(a - b) > 3) return ['review', `the windows disagree (${a} / ${b} cents)`];
    const c = (a + b) / 2;
    return Math.abs(c) <= 5 ? ['accept', ''] : Math.abs(c) <= 25 ? ['review', `${c.toFixed(1)} cents`] : ['reject', `${c.toFixed(1)} cents`];
  },
  '12 phase coherence': (q) => (q.corr >= 0.2 ? ['accept', ''] : q.corr >= 0 ? ['review', `L/R correlation ${q.corr}`] : ['reject', `L/R correlation ${q.corr} (${q.monoLoss} dB in mono)`]),
};

// The instrument's verdicts. rows: [{ id, key, layer, qa }]; waive: [{ check, why }]
export function qaInstrument(rows, waive = [], { drums = false } = {}) {
  const waived = new Map(waive.map((w) => [w.check, w.why]));
  const out = [];
  for (const r of rows) r.verdicts = {};
  for (const [check, fn] of Object.entries(CHECKS)) {
    if (drums && check === '11 tuning') continue;
    const got = rows.map((r) => [r, fn(r.qa)]).filter(([, v]) => v);
    for (const [r, v] of got) r.verdicts[check] = v[0];
    const rej = got.filter(([, v]) => v[0] === 'reject'), rev = got.filter(([, v]) => v[0] === 'review');
    let verdict = rej.length > 0.1 * got.length ? 'reject' : rej.length || rev.length ? 'review' : 'accept';
    const name = (list) => list.slice(0, 6).map(([r, v]) => `${r.id}${v[1] ? ' (' + v[1] + ')' : ''}`).join(', ') + (list.length > 6 ? ', ...' : '');
    let why = `${got.length - rej.length - rev.length} accept, ${rev.length} review, ${rej.length} reject of ${got.length}${got.length < rows.length ? ` (${rows.length - got.length} looped samples have none to read)` : ''}`;
    if (rej.length) why += `; rejected: ${name(rej)}`;
    if (rev.length) why += `; review: ${name(rev)}`;
    if (verdict !== 'accept' && waived.has(check)) { verdict = 'waived'; why += ` (waived: ${waived.get(check)})`; }
    out.push([check, verdict, why]);
  }
  // 9: the source's velocity loudness, from the files themselves
  const peaks = new Set(rows.map((r) => r.qa.peak.toFixed(1).replace('-0.0', '0.0')));
  const by = new Map();
  for (const r of rows) { if (!by.has(r.key)) by.set(r.key, []); by.get(r.key).push(r); }
  const spans = [];
  for (const rs of by.values()) if (rs.length > 1) { rs.sort((a, b) => a.layer - b.layer); spans.push(rs[rs.length - 1].qa.attack - rs[0].qa.attack); }
  let v9 = peaks.size === 1 ? 'review' : spans.every((s) => s >= 0) ? 'accept' : 'reject';
  let w9 = `every file peaks at ${[...peaks].join(' / ')} dBFS: peak-normalized, so the recorded levels are gone (hard minus soft attack, ${spans.length} notes with both: ${Math.min(...spans).toFixed(1)} to ${Math.max(...spans).toFixed(1)} dB)`;
  if (drums) {
    // a kit: each piece's layers (the mean attack level of their strokes) climb, soft to hard, and span 10 dB or more
    const per = [];
    let flat = 0, down = 0;
    for (const rs of by.values()) {
      const L = [];
      for (const r of rs) (L[r.layer] ??= []).push(r.qa.attack);
      const m = L.filter(Boolean).map((a) => a.reduce((x, y) => x + y, 0) / a.length);
      if (m.length < 2) continue;
      if (m.some((x, i) => i && x < m[i - 1])) down++;
      const sp = m[m.length - 1] - m[0]; if (sp < 10) flat++;
      per.push(`${rs[0].id.replace(/\..*$/, '')} ${m.map((x) => x.toFixed(1)).join(' < ')}`);
    }
    v9 = down ? 'reject' : flat ? 'review' : 'accept';
    w9 = `the recorded levels kept (each layer's mean attack, dBFS): ${per.join('; ')}${down ? `; ${down} pieces don't climb` : ''}${flat ? `; ${flat} span under 10 dB` : ''}`;
  }
  if (v9 !== 'accept' && waived.has('9 velocity loudness')) { v9 = 'waived'; w9 += ` (waived: ${waived.get('9 velocity loudness')})`; }
  out.splice(5, 0, ['9 velocity loudness', v9, w9]);
  if (drums) {
    // 15: the round robins of each layer: their attack levels within 1.5 dB (3 is for review), and never one recording
    // twice (the same bytes)
    const groups = new Map();
    for (const r of rows) { const k = `${r.key}.${r.layer}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const wide = [], dup = [];
    for (const rs of groups.values()) {
      if (rs.length < 2) continue;
      const at = rs.map((r) => r.qa.attack), sp = Math.max(...at) - Math.min(...at);
      if (sp > 1.5) wide.push(`${rs[0].id.replace(/\.\d+$/, '')} (${sp.toFixed(1)} dB)`);
      if (new Set(rs.map((r) => r.hash)).size < rs.length) dup.push(rs[0].id.replace(/\.\d+$/, ''));
    }
    let v15 = dup.length ? 'reject' : wide.length ? 'review' : 'accept';
    let w15 = `${groups.size} layers; ${dup.length ? 'the same recording twice in ' + dup.join(', ') + '; ' : ''}${wide.length ? 'strokes more than 1.5 dB apart in ' + wide.join(', ') : 'every layer\'s strokes within 1.5 dB of each other'}`;
    if (v15 !== 'accept' && waived.has('15 round robins')) { v15 = 'waived'; w15 += ` (waived: ${waived.get('15 round robins')})`; }
    out.push(['15 round robins', v15, w15]);
    return { verdicts: out, rows };
  }
  // 11, across layers: one note's layers within 8 cents of each other
  const split = [];
  for (const [k, rs] of by) if (rs.length > 1) { const cs = rs.map((r) => r.qa.cents).filter(([a, b]) => a != null && b != null && Math.abs(a - b) <= 3).map(([a, b]) => (a + b) / 2); if (cs.length > 1 && Math.max(...cs) - Math.min(...cs) > 8) split.push(`${k} (${cs.map((c) => c.toFixed(1)).join(' / ')})`); }
  out.push(['11 tuning, layers', split.length ? 'review' : 'accept', split.length ? `the layers of ${split.length} notes are more than 8 cents apart: ${split.join(', ')}` : 'every note\'s layers within 8 cents of each other']);
  return { verdicts: out, rows };
}
