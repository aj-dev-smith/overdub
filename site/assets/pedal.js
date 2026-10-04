// Cathedral Below: the pedal from the landing page's "describe a sound" story, built for real in Web Audio so you can
// play it. A slow pitch wobble (the water), a lowpass that darkens as MURK turns, two stone rooms blended by NAVE, and
// an equal-power MIX. Every change glides (no zipper, no clicks); the bypass is a 10 ms crossfade. The reverbs are
// seeded noise (no Math.random), so the pedal sounds the same every time. Levels were measured offline by
// tools/brand-test.js (see LEVELS below), not set by ear.
//
//   buildCathedral(ctx, params) -> { input, output, set(params), setOn(on), dispose() }   (any BaseAudioContext)
//   renderStrum(sr) -> { L, R }                                                             the dry guitar (Karplus-Strong)
//   mountPedal(root, { onMeter })                                                           the face, the strum, the ears

export const PARAMS = [
  { key: 'depth', label: 'DEPTH', def: 5, desc: 'how much the water wobbles the pitch' },
  { key: 'nave', label: 'NAVE', def: 6, desc: 'from a chapel to a cathedral' },
  { key: 'murk', label: 'MURK', def: 5, desc: 'how deep under the surface' },
  { key: 'mix', label: 'MIX', def: 6, desc: 'dry guitar to all church' },
];
// Measured by tools/brand-test.js (BS.1770 K-weighted, gated), 48 kHz, the strum below at the defaults:
//   DRY_TRIM brings the strum to about -18 LUFS with true headroom; WET_TRIM sets the fully wet path level with the dry;
//   MURK_COMP [a, b] puts back the loudness the lowpass takes away: a*murk + b*murk^2 dB (fitted to the measured
//   curve). Re-run the test after any DSP change.
export const LEVELS = { DRY_TRIM: 0.5, WET_TRIM: 0.605, MURK_COMP: [-0.587, 0.0962], NAVE_COMP: 0 };

const DEF = Object.fromEntries(PARAMS.map((p) => [p.key, p.def]));

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A stone room: decaying stereo noise, -60 dB at `secs`, darker as it goes, energy-normalised so sizes match in level.
function stoneIR(c, secs, seed) {
  const sr = c.sampleRate, n = Math.ceil(sr * (secs + 0.05)), pre = Math.round(sr * 0.022);
  const buf = c.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const r = mulberry(seed + ch * 1013), d = buf.getChannelData(ch);
    let lp = 0, e = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const env = Math.pow(10, (-60 * t / secs) / 20);
      const k = 0.55 + 0.42 * Math.min(1, t / secs);            // the one-pole closes as the tail ages: stone eats treble
      lp = lp * k + (r() * 2 - 1) * (1 - k);
      const v = lp * env * (t < 0.006 ? t / 0.006 : 1);
      d[i] = v; e += v * v;
    }
    const g = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < n; i++) d[i] *= g;
  }
  return buf;
}

export function buildCathedral(c, params = {}) {
  const P = { ...DEF, ...params };
  const G = (v = 1) => { const g = c.createGain(); g.gain.value = v; return g; };
  const input = G(1), output = G(1);
  const dry = G(0), wet = G(0), fx = G(1), thru = G(0);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
  const lp2 = c.createBiquadFilter(); lp2.type = 'lowpass'; lp2.Q.value = 0.5;
  const dl = c.createDelay(0.06); dl.delayTime.value = 0.014;
  const lfo1 = c.createOscillator(), lfo2 = c.createOscillator(); lfo1.frequency.value = 0.31; lfo2.frequency.value = 0.83;
  const d1 = G(0), d2 = G(0);
  lfo1.connect(d1).connect(dl.delayTime); lfo2.connect(d2).connect(dl.delayTime);
  const small = c.createConvolver(), big = c.createConvolver();
  small.normalize = false; big.normalize = false;
  small.buffer = stoneIR(c, 2.2, 4242); big.buffer = stoneIR(c, 6.5, 9001);
  const gs = G(0), gb = G(0), comp = G(1);
  // wet: lowpass -> wobble -> rooms -> wet gain;  dry: straight
  input.connect(lp).connect(lp2).connect(dl);
  dl.connect(small).connect(gs).connect(comp);
  dl.connect(big).connect(gb).connect(comp);
  comp.connect(wet).connect(fx);
  input.connect(dry).connect(fx);
  fx.connect(output); input.connect(thru).connect(output);
  // the first set() jumps; later ones glide
  let first = true;
  const to = (param, v, tc = 0.03) => { if (first) param.value = v; else param.setTargetAtTime(v, c.currentTime, tc); };
  function set(p) {
    Object.assign(P, p);
    const murk = P.murk / 10, nave = P.nave / 10, mix = P.mix / 10, depth = P.depth / 10;
    const cut = 9000 * Math.pow(2, -murk * 4.2);                    // 9 kHz .. ~490 Hz
    to(lp.frequency, cut, 0.05); to(lp2.frequency, cut * 1.25, 0.05);
    to(d1.gain, depth * 0.0075, 0.08); to(d2.gain, depth * 0.0022, 0.08);
    to(gs.gain, Math.cos(nave * Math.PI / 2)); to(gb.gain, Math.sin(nave * Math.PI / 2));
    to(comp.gain, Math.pow(10, (LEVELS.MURK_COMP[0] * P.murk + LEVELS.MURK_COMP[1] * P.murk * P.murk + LEVELS.NAVE_COMP * P.nave) / 20), 0.05);
    to(dry.gain, Math.cos(mix * Math.PI / 2)); to(wet.gain, Math.sin(mix * Math.PI / 2) * LEVELS.WET_TRIM);
    first = false;
  }
  let on = true;
  function setOn(v, at = c.currentTime) {
    on = !!v;
    fx.gain.setTargetAtTime(on ? 1 : 0, at, 0.0033); thru.gain.setTargetAtTime(on ? 0 : 1, at, 0.0033); // ~10 ms to settle
  }
  thru.gain.value = 0;
  lfo1.start(); lfo2.start();
  set(P);
  return {
    input, output, set, setOn, get on() { return on; }, params: P,
    dispose() { try { lfo1.stop(); lfo2.stop(); } catch (e) { /* stopped */ } input.disconnect(); output.disconnect(); },
  };
}

// The dry guitar: a picked E minor (add 9) arpeggio, Karplus-Strong strings with a seeded pick.
export function renderStrum(sr = 48000) {
  const notes = [40, 47, 52, 55, 59, 66, 59, 55, 52, 47];
  const step = 0.21, ring = 3.2, len = Math.ceil(sr * (notes.length * step + ring + 0.7)); // every note fades out inside the loop
  const L = new Float32Array(len), R = new Float32Array(len);
  const r = mulberry(77);
  notes.forEach((m, i) => {
    const f = 440 * Math.pow(2, (m - 69) / 12), N = Math.max(2, Math.round(sr / f));
    const line = new Float32Array(N);
    let s = 0;
    for (let k = 0; k < N; k++) { s = s * 0.55 + (r() * 2 - 1) * 0.45; line[k] = s; } // a softer pick: low-passed noise
    const start = Math.round((i * step + (r() - 0.5) * 0.012) * sr), dur = Math.round(sr * (ring + 0.6));
    const decay = 0.9965 + Math.min(0.003, (60 - m) * 0.00006), pan = 0.5 + (m - 54) / 60, v = 0.55 + r() * 0.2;
    let idx = 0, prev = 0;
    for (let n = 0; n < dur && start + n < len; n++) {
      const cur = line[idx];
      const nxt = (cur + prev) * 0.5 * decay; prev = cur; line[idx] = nxt;
      idx = (idx + 1) % N;
      const fadeIn = n < 24 ? n / 24 : 1, fadeOut = n > dur - sr * 0.3 ? (dur - n) / (sr * 0.3) : 1;
      const y = cur * v * fadeIn * fadeOut;
      L[start + n] += y * (1 - pan * 0.6); R[start + n] += y * (0.4 + pan * 0.6);
    }
  });
  let pk = 0;
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = (pk ? 1 / pk : 1) * LEVELS.DRY_TRIM;
  for (let i = 0; i < len; i++) { L[i] *= g; R[i] *= g; }
  return { L, R, sr, dur: len / sr };
}

// ---- the face
function knob(p, value, onChange) {
  const el = document.createElement('div');
  el.className = 'knob';
  el.innerHTML = `<div class="knob-cap" role="slider" tabindex="0" aria-label="${p.label[0] + p.label.slice(1).toLowerCase()}: ${p.desc}" aria-valuemin="0" aria-valuemax="10"><i></i></div><span class="knob-label">${p.label}</span><output class="knob-val"></output>`;
  const cap = el.firstElementChild, out = el.querySelector('output');
  let v = value;
  const show = () => {
    cap.style.setProperty('--turn', `${-135 + v * 27}deg`);
    cap.setAttribute('aria-valuenow', v.toFixed(1)); cap.setAttribute('aria-valuetext', v.toFixed(1));
    out.textContent = v.toFixed(1);
  };
  const setV = (nv) => { nv = Math.round(Math.max(0, Math.min(10, nv)) * 10) / 10; if (nv !== v) { v = nv; show(); onChange(v); } };
  let drag = null;
  cap.addEventListener('pointerdown', (e) => { cap.setPointerCapture(e.pointerId); drag = { y: e.clientY, x: e.clientX, v }; cap.focus({ preventScroll: true }); e.preventDefault(); });
  cap.addEventListener('pointermove', (e) => { if (!drag) return; const d = (drag.y - e.clientY) + (e.clientX - drag.x) * 0.5; setV(drag.v + d / 18 * (e.shiftKey ? 0.2 : 1)); });
  const end = () => { drag = null; };
  cap.addEventListener('pointerup', end); cap.addEventListener('pointercancel', end);
  cap.addEventListener('dblclick', () => setV(p.def));
  cap.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1 : 0.5;
    const map = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 2, PageDown: -2 };
    if (e.key in map) { setV(v + map[e.key]); e.preventDefault(); }
    else if (e.key === 'Home') { setV(0); e.preventDefault(); } else if (e.key === 'End') { setV(10); e.preventDefault(); }
  });
  show();
  return el;
}

// K-weighting for the live meter: the BS.1770 pre-filter (a high shelf) and RLB high-pass, as biquads.
function kWeight(c, src) {
  const sh = c.createBiquadFilter(); sh.type = 'highshelf'; sh.frequency.value = 1500; sh.gain.value = 4;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
  src.connect(sh).connect(hp);
  return hp;
}

export function mountPedal(root, { onMeter } = {}) {
  const values = { ...DEF };
  root.innerHTML = `
    <div class="face face--cathedral" data-on="true">
      <div class="face-head"><span class="face-led" aria-hidden="true"></span><span class="face-by">by your agent</span></div>
      <div class="face-knobs"></div>
      <div class="face-plate"><span class="face-name">Cathedral Below</span><span class="face-kind">Submerged reverb</span></div>
      <button class="face-foot" type="button" aria-pressed="true" aria-label="Cathedral Below on or off"><span></span></button>
    </div>
    <div class="pedal-controls">
      <button class="btn btn--play" type="button" data-play><span class="btn-icon" aria-hidden="true">▶</span> <span data-label>Strum through it</span></button>
      <p class="pedal-hint">Drag the knobs, or tab to one and use the arrow keys. The footswitch compares it with the dry guitar.</p>
    </div>`;
  const face = root.querySelector('.face'), knobs = root.querySelector('.face-knobs'), foot = root.querySelector('.face-foot');
  const playBtn = root.querySelector('[data-play]'), playLabel = root.querySelector('[data-label]');
  let ctx = null, rig = null, dryBuf = null, src = null, meterTap = null, raf = 0;
  const api = { values, get ctx() { return ctx; }, get playing() { return !!src; } };

  for (const p of PARAMS) knobs.appendChild(knob(p, values[p.key], (v) => { values[p.key] = v; if (rig) rig.set({ [p.key]: v }); }));
  foot.addEventListener('click', () => {
    const on = foot.getAttribute('aria-pressed') !== 'true';
    foot.setAttribute('aria-pressed', String(on)); face.dataset.on = String(on);
    if (rig) rig.setOn(on);
  });

  async function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'playback' });
    rig = buildCathedral(ctx, values);
    rig.setOn(foot.getAttribute('aria-pressed') === 'true');
    const safety = ctx.createDynamicsCompressor(); // a safety net at -1 dBFS; the measured trims keep it idle
    safety.threshold.value = -2; safety.knee.value = 0; safety.ratio.value = 20; safety.attack.value = 0.002; safety.release.value = 0.12;
    rig.output.connect(safety).connect(ctx.destination);
    const s = renderStrum(ctx.sampleRate);
    dryBuf = ctx.createBuffer(2, s.L.length, ctx.sampleRate);
    dryBuf.copyToChannel(s.L, 0); dryBuf.copyToChannel(s.R, 1);
    // the ears: a spectrum analyser, and per-channel K-weighted taps for loudness (BS.1770 sums the channels' power)
    const an = ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0.6;
    const spl = ctx.createChannelSplitter(2);
    rig.output.connect(an); rig.output.connect(spl);
    const taps = [0, 1].map((ch) => {
      const pick = ctx.createGain(); spl.connect(pick, ch);
      const a = ctx.createAnalyser(); a.fftSize = 32768;
      kWeight(ctx, pick).connect(a);
      return a;
    });
    meterTap = { an, taps, spec: new Float32Array(an.frequencyBinCount), td: new Float32Array(32768), td2: new Float32Array(an.fftSize) };
  }

  function stop() {
    if (src) {
      const { node, gain } = src, t = ctx.currentTime;
      gain.gain.setTargetAtTime(0, t, 0.015);              // fade, then stop: no click
      try { node.stop(t + 0.12); } catch (e) { /* done */ }
      src = null;
    }
    playBtn.classList.remove('is-on'); playLabel.textContent = 'Strum through it';
    playBtn.querySelector('.btn-icon').textContent = '▶';
  }
  playBtn.addEventListener('click', async () => {
    if (src) return stop();
    await ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    const node = ctx.createBufferSource(); node.buffer = dryBuf; node.loop = true;
    const gain = ctx.createGain();
    node.connect(gain).connect(rig.input);
    const t = Math.ceil((ctx.currentTime + 0.05) * ctx.sampleRate) / ctx.sampleRate; // start on a sample frame
    node.start(t);
    src = { node, gain };
    playBtn.classList.add('is-on'); playLabel.textContent = 'Stop'; playBtn.querySelector('.btn-icon').textContent = '■';
    loop();
  });

  // ~30 Hz: read the ears and hand the numbers to whoever shows them
  let last = 0, peakHold = -Infinity;
  function loop() {
    cancelAnimationFrame(raf);
    const step = (now) => {
      if (!meterTap) return;
      if (now - last > 33) {
        last = now;
        const { an, taps, spec, td, td2 } = meterTap;
        const win = Math.min(td.length, Math.round(0.4 * ctx.sampleRate)); // the 400 ms momentary window
        let ms = 0;
        for (const a of taps) { a.getFloatTimeDomainData(td); let s = 0; for (let i = td.length - win; i < td.length; i++) s += td[i] * td[i]; ms += s / win; }
        const lufs = ms > 1e-10 ? -0.691 + 10 * Math.log10(ms) : -Infinity;
        an.getFloatTimeDomainData(td2);
        let pk = 0; for (let i = 0; i < td2.length; i++) pk = Math.max(pk, Math.abs(td2[i]));
        const pkDb = 20 * Math.log10(pk + 1e-9);
        peakHold = Math.max(peakHold - 0.4, pkDb);
        an.getFloatFrequencyData(spec);
        const binHz = ctx.sampleRate / an.fftSize;
        const edges = [[0, 60], [60, 250], [250, 500], [500, 2000], [2000, 4000], [4000, 6000], [6000, 20000]];
        let tot = 0, cen = 0; const e = edges.map(() => 0);
        for (let i = 1; i < spec.length; i++) {
          const p = Math.pow(10, spec[i] / 10), f = i * binHz;
          tot += p; cen += p * f;
          for (let b = 0; b < edges.length; b++) if (f >= edges[b][0] && f < edges[b][1]) { e[b] += p; break; }
        }
        const bands = e.map((x) => 10 * Math.log10((x + 1e-20) / (tot + 1e-20)));
        onMeter && onMeter({ lufs, peak: peakHold, bands, centroid: tot ? cen / tot : 0, on: rig.on, playing: !!src });
      }
      if (src || (meterTap && now - last < 1500)) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  api.stop = stop;
  return api;
}
