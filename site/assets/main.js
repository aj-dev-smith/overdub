// The landing page: one animation loop (the Weave), everything else moves only when you touch it.
import { createWeave, noteName } from './weave.js';
import { startMic } from './pitch.js';
import { mountPedal } from './pedal.js';
import { mountSigned } from './signed.js';
import { mountHeritage } from './faces.js';

const $ = (s, r = document) => r.querySelector(s);
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
const site = (window.__overdub_site = { frames: 0, reduced: mq.matches, errors: [] });

// ---- the Weave and its one loop (paused when off screen or in a background tab)
const canvas = $('#weave');
const weave = createWeave(canvas, { reduced: mq.matches });
site.weave = weave;
let visible = true, raf = 0;
const loop = (now) => { raf = 0; weave.frame(now); site.frames++; if (visible && !document.hidden && (!mq.matches || weave.state.mode === 'live')) raf = requestAnimationFrame(loop); };
const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) kick(); }).observe(canvas);
document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
mq.addEventListener('change', () => location.reload());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { weave.recolor(); kick(); }); // labels in the real face
kick();

// ---- hum into it: your voice becomes the warm strand, and the cool one answers
const humBtn = $('#hum'), humLabel = $('[data-label]', humBtn), note = $('#hum-note'), readout = $('#readout');
const NOTE_DEFAULT = note.textContent;
let mic = null;
function setReadout(m) {
  if (m == null) { readout.innerHTML = weave.state.mode === 'live' ? '<span>Listening. Hum a few notes.</span>' : ''; return; }
  const n = Math.round(m), cents = Math.round((m - n) * 100), ans = weave.state.answer;
  readout.innerHTML = `<b>${noteName(n)}</b><span>${cents >= 0 ? '+' : '−'}${Math.abs(cents)} cents${ans ? `, <i>answer ${ans}</i>` : ''}</span>`;
}
async function humOn() {
  humBtn.disabled = true;
  try {
    let lastShown = 0;
    mic = await startMic({
      onPitch(m, t) {
        weave.push(m, t); site.lastPitch = m;
        if (t - lastShown > 0.08 || m == null) { setReadout(m); lastShown = t; }
      },
    });
    weave.live(); site.mode = 'live';
    humBtn.setAttribute('aria-pressed', 'true'); humLabel.textContent = 'Stop listening';
    note.classList.remove('is-error'); note.textContent = 'Listening. Your voice is the warm strand. The cool one answers with the same intervals the other way up, worked out on this page; in the studio, a real agent plays the answer. Press again to stop; the mic turns off.';
    setReadout(null); kick();
  } catch (e) {
    note.classList.add('is-error'); note.textContent = e.message || String(e);
  } finally { humBtn.disabled = false; }
}
function humOff() {
  if (mic) { mic.stop(); mic = null; }
  weave.demo(); site.mode = 'demo';
  humBtn.setAttribute('aria-pressed', 'false'); humLabel.textContent = 'Hum into it';
  note.textContent = NOTE_DEFAULT; readout.innerHTML = ''; kick();
}
humBtn.addEventListener('click', () => (mic ? humOff() : humOn()));
weave.onNote = (n) => { site.lastNote = n; };

// ---- the playable pedal and the ears beside it
const meter = $('#meter');
const fmt = (v, d = 1) => (isFinite(v) ? (v < 0 ? '−' : '') + Math.abs(v).toFixed(d) : '−∞');
const BAND_KEYS = ['sub', 'low', 'lowmid', 'mid', 'highmid', 'presence', 'air'];
let dryRef = null;
const pedal = mountPedal($('#pedal'), {
  onMeter(m) {
    site.meter = m;
    meter.classList.toggle('is-live', m.playing);
    $('[data-hint]', meter).textContent = m.playing ? (m.on ? 'Measuring Cathedral Below, live.' : 'Measuring the dry guitar (the pedal is bypassed).') : 'Stopped. These were the last numbers.';
    $('[data-lufs]', meter).textContent = fmt(m.lufs);
    $('[data-peak]', meter).textContent = fmt(m.peak);
    $('[data-centroid]', meter).textContent = isFinite(m.centroid) ? Math.round(m.centroid) : '–';
    $('[data-state]', meter).textContent = m.on ? 'on' : 'bypassed';
    const bars = meter.querySelectorAll('[data-bands] i');
    m.bands.forEach((db, i) => { bars[i].parentElement.style.setProperty('--h', Math.max(0.03, Math.min(1, (db + 36) / 36)).toFixed(3)); });
    if (!m.on && isFinite(m.lufs)) dryRef = m.lufs;
    const json = { lufsMomentary: +m.lufs.toFixed(1), peak: +m.peak.toFixed(1), centroid: Math.round(m.centroid), bands: Object.fromEntries(BAND_KEYS.map((k, i) => [k, +m.bands[i].toFixed(1)])) };
    if (dryRef != null && m.on && isFinite(m.lufs)) json.vsDry = +(m.lufs - dryRef).toFixed(1);
    $('[data-json]', meter).textContent = 'render_and_measure: ' + JSON.stringify(json, null, 1).replace(/\n\s*/g, ' ');
  },
});
site.pedal = pedal;

// ---- signed edits, and the pedalboard
site.signed = mountSigned($('#signed'));
mountHeritage($('#board'));
site.ready = true;
