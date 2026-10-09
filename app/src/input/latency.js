// Round-trip latency: how late what you play reaches the page, so recordings, hums and beatbox land on the beat.
// A note you play in time with what you hear arrives late by the output's delay (the page's buffer, the interface's,
// the speakers) plus the input's. Browsers report both (track settings' latency, the context's baseLatency and
// outputLatency), but on real interfaces the numbers are often wrong, so measure it once per input device:
//   tap along: 8 clicks at 100 bpm (2 warm-up); you clap, tap or mute-strum on each; the median of the onsets' offsets
//     is the round trip as you play it (your own feel included, which is what the takes should follow);
//   loopback: a cable from an output to the input (or the mic at a speaker): three chirps go out and are found in the
//     input by cross-correlation, to the sample.
// Ported from clawd-o-matic (plug/00-latency.js). The core is pure (tools/input-test.js runs it in Node).
//
//   median, onset(x, sr, a, b), hits(x, sr, clicks), xcorr(ref, x, from, maxLag), chirp(sr), click(sr, hi)
//   createLatency(audio) -> { get(), estimate(), measured, set(ms, info), clear(), measure({ how, onStep, sig }), onChange }

export const median = (a) => { const s = a.slice().sort((p, q) => p - q), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

// The onset of a hit in x[a, b): on the first difference (a pick's edge, a clap's crack), in 2 ms frames: the earliest
// loud frame that jumps well over the frames before it, then the first sample in it clear of what came before. -1: none.
export function onset(x, sr, a, b) {
  a = Math.max(1, Math.floor(a)); b = Math.min(x.length, Math.floor(b));
  const W = Math.max(16, Math.round(sr * 0.002)), nF = Math.floor((b - a) / W);
  if (nF < 12) return -1;
  const E = new Float64Array(nF);
  let mx = 0;
  for (let f = 0; f < nF; f++) {
    let s = 0;
    for (let i = a + f * W, e = i + W; i < e; i++) { const d = x[i] - x[i - 1]; s += d * d; }
    E[f] = s; if (s > mx) mx = s;
  }
  if (!(mx > 1e-12) || mx < 20 * median(Array.from(E))) return -1;
  let at = -1;
  for (let f = 2; f < nF; f++) {
    if (E[f] < 0.1 * mx) continue;
    let pre = 0; for (let g = Math.max(0, f - 6); g < f - 1; g++) pre += E[g];
    pre /= Math.max(1, Math.min(5, f - 1));
    if (E[f] > 6 * pre + 1e-9 * mx) { at = f; break; }
  }
  if (at < 0) return -1;
  let nz = 0, nn = 0, pk = 0;
  for (let i = a + Math.max(0, at - 8) * W, e = a + Math.max(0, at - 2) * W; i < e; i++) { const d = x[i] - x[i - 1]; nz += d * d; nn++; }
  nz = Math.sqrt(nz / Math.max(1, nn));
  for (let i = a + at * W, e = Math.min(b, i + 3 * W); i < e; i++) pk = Math.max(pk, Math.abs(x[i] - x[i - 1]));
  const th = Math.max(4 * nz, 0.05 * pk);
  for (let i = a + Math.max(0, at - 1) * W, e = Math.min(b, a + (at + 3) * W); i < e; i++) if (Math.abs(x[i] - x[i - 1]) > th) return i;
  return a + at * W;
}
// Each click's hit (clicks: sample indexes into x): ms after the click, or null.
export function hits(x, sr, clicks, pre = 0.15, post = 0.45) {
  return clicks.map((c) => { const o = onset(x, sr, c - pre * sr, c + post * sr); return o < 0 ? null : ((o - c) / sr) * 1000; });
}
// Where ref sits in x after `from`: the lag (samples, refined by a parabola) of the biggest cross-correlation within
// maxLag; ratio: that peak over the correlation's rms (a clean find is well over 8). Either polarity.
export function xcorr(ref, x, from, maxLag) {
  const N = ref.length, L = Math.max(0, Math.min(maxLag, x.length - from - N));
  if (L < 3) return { lag: NaN, ratio: 0 };
  const c = new Float64Array(L + 1);
  let best = 0, sq = 0;
  for (let k = 0; k <= L; k++) {
    let s = 0;
    for (let j = 0, o = from + k; j < N; j++) s += ref[j] * x[o + j];
    c[k] = s; sq += s * s;
    if (Math.abs(s) > Math.abs(c[best])) best = k;
  }
  const sg = Math.sign(c[best]) || 1, y0 = best > 0 ? sg * c[best - 1] : 0, y1 = sg * c[best], y2 = best < L ? sg * c[best + 1] : 0, den = y0 - 2 * y1 + y2;
  return { lag: best + (den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0), ratio: Math.abs(c[best]) / Math.sqrt(sq / (L + 1) + 1e-30), sign: sg };
}
// 40 ms sweeping 700 Hz to 7 kHz (laptop speakers and phone mics both carry that), faded in and out.
export function chirp(sr, amp = 0.35) {
  const n = Math.round(0.04 * sr), f0 = 700, f1 = 7000, T = n / sr, fade = Math.round(0.003 * sr), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = i < fade ? 0.5 - 0.5 * Math.cos((Math.PI * i) / fade) : i > n - fade ? 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / fade) : 1;
    y[i] = amp * w * Math.sin(2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * T)));
  }
  return y;
}
// The metronome's knock (the warm-up and count-in ones higher).
export function click(sr, hi) {
  const n = Math.round(0.04 * sr), f = hi ? 1760 : 1175, y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; y[i] = 0.55 * Math.exp(-t / 0.007) * Math.sin(2 * Math.PI * f * t) * Math.min(1, i / 8); }
  return y;
}

/* ---------------------------------------------------------------- the page: measure, keep per device */
const KEY = 'overdub:latency';
export function createLatency(audio) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; if (typeof all !== 'object' || Array.isArray(all)) all = {}; } catch { all = {}; }
  const fns = new Set();
  const fire = () => { for (const fn of fns) { try { fn(api.measured); } catch (e) { console.error('latency onChange', e); } } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ } };
  const dev = () => String(audio.state.deviceId || 'default');
  const api = {
    // seconds: measured for this input, else the browser's guess
    get() { const m = api.measured; return m ? m.ms / 1000 : api.estimate(); },
    estimate() {
      const c = audio.ctx, st = audio.state.settings || {};
      return (+st.latency || 0) + (c ? (c.baseLatency || 0) + (c.outputLatency || 0) : 0);
    },
    get measured() { const m = all[dev()]; return m && Number.isFinite(+m.ms) ? { ...m, device: dev() } : null; },
    set(ms, info = {}) {
      if (!Number.isFinite(+ms)) return false;
      all[info.device || dev()] = { ms: Math.round(Math.max(0, Math.min(1000, +ms)) * 100) / 100, at: Date.now(), how: info.how || 'manual', spread: info.spread ?? null, label: info.label ?? audio.state.label ?? '' };
      save(); fire(); return true;
    },
    clear() { delete all[dev()]; save(); fire(); },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    // Run one measurement. how: 'tap' (tap/clap/strum along to 8 clicks) | 'loop' (chirps through a loopback).
    // onStep({ i, ms, click }) as it goes. Resolves { ok, ms, spread|agree, hits|finds } (not saved: call set()).
    async measure({ how = 'tap', onStep = null, sig = {} } = {}) {
      await audio.ensureOpen();
      const c = audio.ctx, sr = c.sampleRate, out = c.destination;
      const bufOf = (y) => { const b = c.createBuffer(1, y.length, sr); b.copyToChannel(y, 0); return b; };
      const shot = (b, t) => { const s = c.createBufferSource(); s.buffer = b; s.connect(out); s.start(t); return s; };
      const record = (F0, F1, onBlock) => new Promise((res) => {
        const x = new Float32Array(F1 - F0);
        let hi = F0, done = false;
        const off = audio.listen((blk) => {
          const d = blk.d[0], f = blk.f, s = Math.max(f, F0), t = Math.min(f + d.length, F1);
          if (t > s) x.set(d.subarray(s - f, t - f), s - F0);
          hi = Math.max(hi, Math.min(F1, f + d.length));
          if (onBlock) onBlock(x, hi);
          if (hi >= F1) finish(x);
        });
        const iv = setInterval(() => { if (sig.stop) finish(null); else if (c.currentTime * sr > F1 + sr) finish(x); }, 100);
        function finish(v) { if (done) return; done = true; clearInterval(iv); off(); res(v); }
      });
      if (how === 'loop') {
        const reps = 3, gap = Math.round(0.5 * sr), maxLag = Math.round(0.45 * sr), ref = chirp(sr), b = bufOf(ref);
        const F0 = Math.round((c.currentTime + 0.4) * sr), F = [];
        for (let k = 0; k < reps; k++) F.push(F0 + k * gap);
        const src = F.map((f) => shot(b, f / sr));
        const x = await record(F0, F[reps - 1] + gap + ref.length);
        if (!x) { for (const s of src) { try { s.stop(); } catch { /* done */ } } return null; }
        const finds = F.map((f) => xcorr(ref, x, f - F0, maxLag));
        const good = finds.filter((r) => r.ratio >= 8 && Number.isFinite(r.lag));
        const lags = good.map((r) => r.lag), lag = median(lags);
        const res = { how, finds, ms: (lag / sr) * 1000, found: good.length, of: reps, agree: lags.length ? ((Math.max(...lags) - Math.min(...lags)) / sr) * 1000 : NaN };
        res.ok = good.length >= 2 && res.agree <= 0.1;
        return res;
      }
      const n = 8, warm = 2, beat = 60 / 100, t0 = c.currentTime + 0.9, F = [];
      for (let i = 0; i < n; i++) F.push(Math.round((t0 + i * beat) * sr));
      const pre = Math.round(0.15 * sr), post = Math.round(0.45 * sr), hiB = bufOf(click(sr, true)), loB = bufOf(click(sr, false));
      const src = F.map((f, i) => shot(i < warm ? hiB : loB, f / sr));
      F.forEach((f, i) => setTimeout(() => onStep && onStep({ i, click: true }), Math.max(0, (f / sr - c.currentTime) * 1000)));
      const hs = new Array(n).fill(undefined);
      let next = 0;
      const x = await record(F[0] - pre, F[n - 1] + post, (buf, hi) => {
        while (next < n && hi - (F[0] - pre) >= F[next] - F[0] + pre + post) {
          const on = onset(buf, sr, F[next] - F[0], F[next] - F[0] + pre + post);
          hs[next] = on < 0 ? null : ((on - (F[next] - F[0] + pre)) / sr) * 1000;
          if (onStep) onStep({ i: next, ms: hs[next] });
          next++;
        }
      });
      if (!x) { for (const s of src) { try { s.stop(); } catch { /* done */ } } return null; }
      const used = hs.slice(warm).filter((v) => v != null);
      const res = { how, hits: hs, used: used.length, of: n - warm, ms: median(used), spread: used.length ? Math.max(...used) - Math.min(...used) : NaN };
      res.ok = used.length >= 4 && res.spread <= 40;
      return res;
    },
  };
  return api;
}
