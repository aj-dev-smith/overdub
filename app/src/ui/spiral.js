// The pitch spiral: a functional pitch picture, not a logo. One turn is one octave (the angle is the pitch class, so every C lines up
// on one spoke), and the radius grows with pitch, so a melody draws itself as a path that winds out as it climbs. The
// live pitch is a bright head with a fading trail, held notes are glowing beads, the song's key shows as faint spokes
// (the tonic labelled), and in tuner mode the head shows how many cents it is off.
//
//   const sp = createSpiral({ lo = 36, hi = 96, key, tuner = false, labels = true });
//   el.append(sp.el); in your panel's frame(now): sp.frame(now)
//   sp.push(midiFloat | null, { conf })   the live pitch (null: silence)      sp.setHeld([pitches])  beads
//   sp.pulse(p)   a bead flashes (a note was caught)   sp.setKey(key)   sp.setTuner(on)   sp.setRange(lo, hi)   sp.destroy()
//
// Colours run low to high: the inner turns cool (var(--agent)), the middle grease pencil (var(--accent-2)), the outer
// warm (var(--human)); the head is warm, because it is you. Drawn on one canvas, only in frame(now).

import { canvas, tok, css } from './dom.js';
import { scalePcs, parsePc, noteName, spellPc, spellNote } from '../core/music.js';

const TAU = Math.PI * 2;
// note names are spelled for the key (C minor's Eb Ab Bb, as the piano roll writes them, never D# G# A#); with no key,
// C major's (C# Eb F# Ab Bb)
const NO_KEY = { root: 'C', scale: 'major' };
const REDUCED = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

export function createSpiral({ lo = 36, hi = 96, key = null, tuner = false, labels = true, center = true } = {}) {
  css('spiral', `.ew-spiral { position: relative; width: 100%; height: 100%; min-width: 60px; min-height: 60px; }
.ew-spiral canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }`);
  const el = document.createElement('div');
  el.className = 'ew-spiral';
  const C = canvas();
  el.append(C.cv);
  const st = {
    lo, hi, key, tuner, labels, center,
    target: null, shown: null, conf: 0, lastHeard: -1e9,
    trail: [],              // { m, t, a }
    held: new Set(), beads: new Map(), // p -> { at, glow }
    pulses: [],             // { p, at }
    colors: null, idleT0: performance.now(),
  };
  const colors = () => {
    if (st.colors) return st.colors;
    st.colors = { human: tok('--human') || '#ffa043', agent: tok('--agent') || '#4cc3ff', accent: tok('--accent') || '#d9f36a', accent2: tok('--accent-2') || '#f1dc8a', text: tok('--text') || '#f4ead6', text2: tok('--text-2') || '#cbc0aa', text3: tok('--text-3') || '#9a8f7c', line: tok('--line') || '#2f2b25', line2: tok('--line-2') || '#46413a', display: tok('--font-display') || "'Arial Black', sans-serif", mono: tok('--font-mono') || 'monospace', ok: tok('--ok') || '#8fdca0', warn: tok('--warn') || '#ffd166' };
    return st.colors;
  };

  // geometry
  let cx = 0, cy = 0, r0 = 0, R = 0;
  const ang = (m) => ((((m % 12) + 12) % 12) / 12) * TAU - Math.PI / 2;
  const rad = (m) => r0 + ((Math.max(st.lo - 1, Math.min(st.hi + 1, m)) - st.lo) / (st.hi - st.lo)) * (R - r0);
  const xy = (m) => { const a = ang(m), r = rad(m); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  const mix = (a, b, t) => {
    const pa = hex(a), pb = hex(b);
    return `rgb(${Math.round(pa[0] + (pb[0] - pa[0]) * t)},${Math.round(pa[1] + (pb[1] - pa[1]) * t)},${Math.round(pa[2] + (pb[2] - pa[2]) * t)})`;
  };
  // the ramp: cool inside, grease pencil in the middle, warm outside
  const ramp = (u) => { const c = colors(); return u < 0.5 ? mix(c.agent, c.accent2, u / 0.5) : mix(c.accent2, c.human, (u - 0.5) / 0.5); };

  const api = {
    el,
    push(m, { conf = 1 } = {}) {
      const now = performance.now();
      if (m == null || !Number.isFinite(m)) { st.target = null; return; }
      st.target = m; st.conf = conf; st.lastHeard = now;
      if (st.shown == null || Math.abs(st.shown - m) > 7) st.shown = m;
    },
    setHeld(ps) {
      const now = performance.now(), next = new Set(ps);
      for (const p of next) if (!st.held.has(p)) st.beads.set(p, { at: now });
      st.held = next;
    },
    pulse(p) { st.pulses.push({ p, at: performance.now() }); if (st.pulses.length > 24) st.pulses.shift(); },
    setKey(k) { st.key = k; },
    setTuner(on) { st.tuner = !!on; },
    setRange(a, b) { st.lo = a; st.hi = b; },
    get state() { return st; },
    frame(now) { draw(now); },
    destroy() { el.remove(); },
  };

  function draw(now) {
    C.fit();
    const g = C.g, w = C.w, h = C.h, c = colors();
    if (w < 10 || h < 10) return;
    g.clearRect(0, 0, w, h);
    cx = w / 2; cy = h / 2; R = Math.min(w, h) / 2 - (st.labels ? 16 : 6); r0 = R * 0.16;
    // the head eases toward the heard pitch (smooth, but quick enough to follow a run)
    if (st.target != null) st.shown = st.shown == null ? st.target : st.shown + (st.target - st.shown) * 0.38;
    const live = st.target != null && now - st.lastHeard < 300;
    if (live) st.trail.push({ m: st.shown, t: now, a: st.conf });
    else if (st.trail.length && st.trail[st.trail.length - 1].m != null) st.trail.push({ m: null, t: now });
    while (st.trail.length && now - st.trail[0].t > 1800) st.trail.shift();

    // a soft lamp behind it
    const bg = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.05);
    bg.addColorStop(0, withA(c.agent, 0.07)); bg.addColorStop(0.55, withA(c.accent2, 0.035)); bg.addColorStop(1, withA(c.human, 0));
    g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R * 1.05, 0, TAU); g.fill();

    // spokes: every pitch class faint, the key's brighter, the tonic labelled
    const pcs = st.key ? new Set(scalePcs(st.key)) : null, tonic = st.key ? parsePc(st.key.root) : null;
    g.lineCap = 'round';
    for (let pc = 0; pc < 12; pc++) {
      const a = (pc / 12) * TAU - Math.PI / 2, inKey = pcs ? pcs.has(pc) : false, isT = pc === tonic;
      g.strokeStyle = isT ? withA(c.accent2, 0.42) : inKey ? withA(c.text2, 0.17) : withA(c.line2, 0.35);
      g.lineWidth = isT ? 1.4 : 1;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0 * 0.7, cy + Math.sin(a) * r0 * 0.7); g.lineTo(cx + Math.cos(a) * (R + 4), cy + Math.sin(a) * (R + 4)); g.stroke();
      if (st.labels && (inKey || !pcs || R > 110)) {
        g.fillStyle = isT ? c.accent2 : inKey ? c.text2 : withA(c.text3, 0.55);
        g.font = `${isT ? 700 : 600} ${R > 110 ? 10.5 : 9}px ${c.mono}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(spellPc(pc, st.key || NO_KEY), cx + Math.cos(a) * (R + 11), cy + Math.sin(a) * (R + 11));
      }
    }

    // the spiral itself, low notes cool and high notes warm, with a slow comet travelling out along it while idle
    // (tapered: thin at the core, fuller at the rim)
    // one polyline per semitone (no seams), butt-capped
    g.lineCap = 'butt'; g.lineJoin = 'round';
    const span = st.hi - st.lo;
    for (let k = 0; k < span; k++) {
      const u = (k + 0.5) / span;
      g.lineWidth = 0.8 + u * Math.max(1.5, R / 38);
      g.strokeStyle = withA(ramp(u), 0.24 + 0.22 * u);
      g.beginPath();
      for (let j = 0; j <= 6; j++) { const [x, y] = xy(st.lo + k + j / 6); if (j) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    g.lineCap = 'round';
    const idle = !live && !st.held.size && !REDUCED();
    const period = 7000, u = ((now - st.idleT0) % period) / period;
    if (idle) {
      const mc = st.lo + u * (st.hi - st.lo);
      for (let k = 0; k < 26; k++) {
        const m = mc - k * 0.22; if (m < st.lo) break;
        const [x, y] = xy(m), a = (1 - k / 26) * 0.55 * Math.sin(Math.PI * u);
        g.fillStyle = withA(ramp((m - st.lo) / (st.hi - st.lo)), a);
        g.beginPath(); g.arc(x, y, Math.max(1, (R / 70) * (1 - k / 30)), 0, TAU); g.fill();
      }
    }
    // octave marks on the C spoke
    if (st.labels && R > 70) {
      g.font = `600 8.5px ${c.mono}`; g.fillStyle = withA(c.text3, 0.65); g.textAlign = 'left';
      for (let m = Math.ceil(st.lo / 12) * 12; m <= st.hi; m += 12) { const [x, y] = xy(m); g.fillText(noteName(m), x + 4, y + 1); }
    }

    // pulses: a note was caught
    for (let i = st.pulses.length - 1; i >= 0; i--) {
      const pu = st.pulses[i], age = (now - pu.at) / 900;
      if (age > 1) { st.pulses.splice(i, 1); continue; }
      const [x, y] = xy(pu.p);
      g.strokeStyle = withA(c.human, 0.7 * (1 - age)); g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 4 + age * 18, 0, TAU); g.stroke();
    }
    // held notes: glowing beads (they bloom in)
    for (const p of st.held) {
      const b = st.beads.get(p) || { at: now }, k = Math.min(1, (now - b.at) / 160), [x, y] = xy(p), rr = Math.max(4, R / 22) * (0.6 + 0.4 * k);
      glow(g, x, y, rr * 3.2, c.human, 0.5);
      g.fillStyle = c.human; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.arc(x - rr * 0.3, y - rr * 0.3, rr * 0.35, 0, TAU); g.fill();
    }

    // the trail (fading with age, thicker toward the head)
    if (st.trail.length > 1) {
      for (let i = 1; i < st.trail.length; i++) {
        const a0 = st.trail[i - 1], a1 = st.trail[i];
        if (a0.m == null || a1.m == null) continue;
        const age = (now - a1.t) / 1800, al = Math.max(0, 1 - age) ** 1.4;
        const [x0, y0] = xy(a0.m), [x1, y1] = xy(a1.m);
        g.strokeStyle = withA(c.human, 0.85 * al * (0.4 + 0.6 * (a1.a ?? 1)));
        g.lineWidth = 1 + 3.2 * al;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    }
    // the head
    if (live && st.shown != null) {
      const [x, y] = xy(st.shown), rr = Math.max(4, R / 20);
      glow(g, x, y, rr * 4.5, c.human, 0.55 * (0.5 + 0.5 * st.conf));
      g.fillStyle = '#fff6ea'; g.beginPath(); g.arc(x, y, rr * 0.75, 0, TAU); g.fill();
      g.strokeStyle = c.human; g.lineWidth = 2; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.stroke();
      if (st.tuner) {
        // where the note is: a notch on the spiral, and the arc from it to the head
        const n = Math.round(st.shown), [nx, ny] = xy(n), cents = Math.round((st.shown - n) * 100), good = Math.abs(cents) <= 5;
        g.strokeStyle = good ? c.ok : withA(c.text, 0.6); g.lineWidth = 2;
        const a = ang(n), r = rad(n);
        g.beginPath(); g.moveTo(nx - Math.cos(a) * 7, ny - Math.sin(a) * 7); g.lineTo(nx + Math.cos(a) * 7, ny + Math.sin(a) * 7); g.stroke();
        g.strokeStyle = withA(good ? c.ok : c.warn, 0.8); g.lineWidth = 3;
        g.beginPath(); g.arc(cx, cy, r, a, ang(st.shown), cents < 0); g.stroke();
      }
    }
    // the centre: the note you're on (and the cents in tuner mode); or the key, quietly
    if (st.center) {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (live && st.shown != null) {
        const n = Math.round(st.shown), cents = Math.round((st.shown - n) * 100);
        g.fillStyle = c.text; g.font = `700 ${Math.max(14, r0 * 0.95)}px ${c.display}`;
        g.fillText(spellNote(n, st.key || NO_KEY), cx, cy - (st.tuner ? r0 * 0.18 : 0));
        if (st.tuner) { g.font = `600 ${Math.max(9, r0 * 0.38)}px ${c.mono}`; g.fillStyle = Math.abs(cents) <= 5 ? c.ok : c.warn; g.fillText(`${cents > 0 ? '+' : cents < 0 ? '−' : '±'}${Math.abs(cents)}¢`, cx, cy + r0 * 0.55); }
      } else if (st.key && R > 60) {
        g.fillStyle = withA(c.text3, 0.8); g.font = `600 ${Math.max(9, r0 * 0.36)}px ${c.mono}`;
        g.fillText(`${st.key.root} ${st.key.scale.replace(/([A-Z])/g, ' $1').toLowerCase()}`, cx, cy);
      }
    }
  }
  return api;
}

function glow(g, x, y, r, col, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, withA(col, a)); gr.addColorStop(1, withA(col, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}
const HEX = new Map();
function hex(c) {
  if (HEX.has(c)) return HEX.get(c);
  let r = 255, gg = 255, b = 255;
  const s = String(c).trim();
  let m;
  if ((m = /^#([0-9a-f]{6})$/i.exec(s))) { const n = parseInt(m[1], 16); r = n >> 16; gg = (n >> 8) & 255; b = n & 255; }
  else if ((m = /^#([0-9a-f]{3})$/i.exec(s))) { r = parseInt(m[1][0] + m[1][0], 16); gg = parseInt(m[1][1] + m[1][1], 16); b = parseInt(m[1][2] + m[1][2], 16); }
  else if ((m = /^rgba?\(([^)]+)\)/.exec(s))) { const p = m[1].split(',').map(Number); [r, gg, b] = p; }
  const out = [r, gg, b];
  HEX.set(c, out);
  return out;
}
export function withA(c, a) { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`; }
