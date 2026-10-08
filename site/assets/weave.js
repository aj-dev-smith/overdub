// The living Weave: Overdub's mark, played. A strip of tape runs right to left past the record head (the leader-green
// playhead). Two strands are written at the head: the warm one is you (played: it breathes, drifts and wobbles a
// little), the cool one is your agent (exact). They cross on the centre line and take turns on top, warm over at one
// crossing and cool over at the next: play over each other. With the sound off it reads in two seconds; when you
// hum, your voice becomes the warm strand and the cool strand answers in exact semitones.
//
//   const w = createWeave(canvas, { reduced })
//   w.demo()                     the built-in take, on a loop (what the page does until you hum)
//   w.live()                     switch to live input; then w.push(midiFloat | null, timeSec) ~30x a second
//   w.frame(now)                 draw (main.js owns the one rAF loop)
//   w.state                      { mode, frames, crossings (on screen), notes, current, answer, answers } (tests read it)
//   w.onNote = (note) => {}      a hummed note was written down ({ p, name, t0, t1 })

export const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const noteName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

const css = (name, fb) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
const BPM = 92,
  BEAT = 60 / BPM,
  BAR = 4 * BEAT; // one bar is one wavelength: a crossing on beat 1 and on beat 3
const DT = 1 / 90; // tape samples per second (independent of the frame rate)
const RANGE = 6; // semitones from the centre line to the edge of the swing

// Seeded wobble: the same take every time (no Math.random anywhere on the page).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(92);
const PART = Array.from({ length: 6 }, () => [0.5 + R() * 0.9, R() * 6.28]); // slow, incommensurate drifts

// The demo take, as functions of tape time (seconds). Both are in units of "the swing" (-1 .. 1, up is +).
// You: a sung line that leans on the beat, breathes in level, and has vibrato once a phrase settles.
function warmAt(t) {
  const drift =
    0.035 * Math.sin((2 * Math.PI * t) / (BAR * 3.1) + PART[0][1]) +
    0.02 * Math.sin((2 * Math.PI * t) / (BAR * 1.7) + PART[1][1]);
  const ph = 2 * Math.PI * (t / BAR + drift);
  const amp =
    0.86 +
    0.12 * Math.sin((2 * Math.PI * t) / (BAR * 2.3) + PART[2][1]) +
    0.05 * Math.sin((2 * Math.PI * t) / (BAR * 0.9) + PART[3][1]);
  const hold = Math.pow(Math.abs(Math.sin(ph)), 6); // vibrato only where a note is held, at the top of the swing
  const vib = 0.014 * Math.sin(2 * Math.PI * 4.6 * t + PART[4][1]) * hold;
  const lean = 0.07 * Math.sin(2 * ph + PART[5][1]); // a little asymmetry: a voice, not a sine
  return amp * Math.sin(ph) + vib + lean;
}
// Your agent: exact. Same tempo, opposite direction, constant level.
const coolAt = (t) => -0.82 * Math.sin((2 * Math.PI * t) / BAR);

export function createWeave(canvas, { reduced = false } = {}) {
  const g = canvas.getContext('2d');
  const C = {};
  const readColors = () =>
    Object.assign(C, {
      bg: css('--bg', '#141210'),
      line: css('--line', '#2f2b25'),
      line2: css('--line-2', '#46413a'),
      text: css('--text', '#f4ead6'),
      text2: css('--text-2', '#cbc0aa'),
      text3: css('--text-3', '#9a8f7c'),
      human: css('--human', '#ffa043'),
      agent: css('--agent', '#4cc3ff'),
      accent: css('--accent', '#d9f36a'),
      ui: css('--font-ui', 'system-ui'),
      mono: css('--font-mono', 'monospace'),
    });
  readColors();

  let W = 0,
    H = 0,
    dpr = 1,
    HX = 0,
    cy = 0,
    amp = 0,
    sw = 0,
    speed = 100;
  const state = { mode: 'demo', frames: 0, crossings: 0, notes: [], current: null, answer: null, answers: 0 };
  const api = { state, onNote: null };

  // The tape: samples { t, w (warm, or null when you're silent), c (cool) } and the crossings found as they were written.
  let tape = [],
    crossings = [],
    nCross = 0,
    tNow = 0,
    tStart = null,
    clockAt = 0;
  // live input
  let live = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    HX = Math.round(Math.min(W * 0.76, W - (W < 600 ? 104 : 150))); // room right of the head for the labels
    const barPx = Math.max(170, Math.min(430, W * 0.3));
    speed = barPx / BAR;
    cy = H * 0.52;
    amp = Math.min(H * 0.3, barPx * 0.4);
    sw = Math.max(8, Math.min(22, amp * 0.24)); // the mark's proportions, thinner
    if (state.frames) draw(); // resizing clears the canvas
  }

  // ---- writing the tape
  function sampleAt(t) {
    if (state.mode === 'demo' || !live) return { t, w: warmAt(t), c: coolAt(t) };
    return liveSample(t);
  }
  function write(s) {
    const prev = tape[tape.length - 1];
    tape.push(s);
    if (prev && prev.w != null && s.w != null) {
      const a = prev.w - prev.c,
        b = s.w - s.c;
      if (a < 0 !== b < 0 && a !== b) {
        const k = a / (a - b);
        // take turns: you are on top at the first crossing, your agent at the next
        crossings.push({ t: prev.t + k * (s.t - prev.t), over: nCross % 2 === 0 ? 'warm' : 'cool' });
        nCross++;
      }
    }
    const keep = tNow - (HX + sw * 4) / speed - 1;
    if (tape.length > 4 && tape[0].t < keep) {
      let i = 0;
      while (i < tape.length && tape[i].t < keep) i++;
      tape.splice(0, i);
    }
    if (crossings.length && crossings[0].t < keep) crossings = crossings.filter((c) => c.t >= keep);
  }
  function advance(t) {
    let last = tape.length ? tape[tape.length - 1].t : t - DT;
    while (last + DT <= t + 1e-9) {
      last += DT;
      write(sampleAt(last));
    }
  }
  // Fill the whole visible strip, so the first frame already shows a woven take (and a reduced-motion still does).
  function prefill(t) {
    tape = [];
    crossings = [];
    nCross = 0;
    const from = t - (HX + sw * 4) / speed - 0.5;
    // start counting on a crossing where you're on top, so the pattern matches the mark
    const t0 = Math.floor(from / BAR) * BAR;
    for (let x = t0; x <= t + 1e-9; x += DT) write(sampleAt(x));
    // the first crossing you can see (past the fade) is yours: warm on top, as in the mark
    tNow = t;
    const first = crossings.find((k) => X(k.t) > Math.min(160, W * 0.16));
    if (first && first.over !== 'warm') {
      for (const k of crossings) k.over = k.over === 'warm' ? 'cool' : 'warm';
      nCross++;
    }
  }

  // ---- live: your pitch becomes the warm strand; the cool strand answers it, mirrored and quantized, gliding exactly
  api.live = () => {
    state.mode = 'live';
    state.notes = [];
    state.current = null;
    state.answer = null;
    live = {
      center: null,
      last: null,
      lastT: -1,
      voicedAt: -9,
      glide: { from: 0, to: 0, at: 0 },
      q: null,
      cand: null,
      notes: state.notes,
    };
  };
  api.demo = () => {
    state.mode = 'demo';
    live = null;
    state.current = null;
    state.answer = null;
  };
  api.push = (m, t) => {
    if (state.mode !== 'live' || !live) return;
    const ok = m != null && m > 30 && m < 100;
    state.current = ok ? m : null;
    const tt = tNow + Math.max(0, t - clockAt); // the mic's clock, on the tape's clock
    if (ok) {
      live.center = live.center == null ? m : live.center;
      live.last = m;
      live.lastT = tt;
      live.voicedAt = tt;
    } else live.last = null;
    segment(ok ? m : null, t);
  };
  function liveSample(t) {
    const L = live,
      c0 = L.center;
    // the take is written slightly behind the voice (the pitch tracker's latency): use what we last heard
    const voiced = L.last != null && t - L.lastT < 0.25;
    let w = null;
    if (voiced) {
      L.sm = L.sm == null || L.gap ? L.last : L.sm + (L.last - L.sm) * Math.min(1, DT / 0.045); // a little smoothing: a voice, not tracker jitter
      L.gap = false;
      L.center += (L.last - L.center) * Math.min(1, DT / 3); // the centre line follows where you sing, slowly
      w = Math.max(-1.25, Math.min(1.25, (L.sm - L.center) / RANGE));
      const q = -Math.round(L.last - Math.round(L.center)); // the answer: the same interval the other way, in semitones
      if (q !== L.q) {
        L.glide = { from: glideVal(t), to: q / RANGE, at: t };
        L.q = q;
        state.answer = noteName(Math.round(L.center) + q);
        state.answers++;
      }
    } else L.gap = true;
    const silent = t - L.voicedAt;
    let c = glideVal(t);
    if (c0 == null || silent > 0.7) {
      // nothing to answer: the agent keeps time on its own, exactly, easing in
      const k = c0 == null ? 1 : Math.min(1, (silent - 0.7) / 1.2),
        e = k * k * (3 - 2 * k);
      c = c * (1 - e) + coolAt(t) * e;
      if (silent > 0.7) {
        L.q = null;
        L.glide = { from: c, to: c, at: t };
        state.answer = null;
      }
    }
    return { t, w, c };
  }
  function glideVal(t) {
    const G = live.glide,
      k = Math.min(1, Math.max(0, (t - G.at) / 0.11));
    return G.from + (G.to - G.from) * k * k * (3 - 2 * k);
  }
  // Notes: one starts once the voice holds within half a semitone for 120 ms; it ends when the voice stops or moves
  // away for 80 ms. (The studio's own tracker does more; this is the page's small copy.)
  function segment(m, t) {
    const L = live,
      c = L.cand;
    if (m == null) {
      if (c && c.on) endNote(c, t);
      L.cand = null;
      return;
    }
    if (!c) {
      L.cand = { ref: m, t0: t, away: 0, on: false, sum: m, n: 1 };
      return;
    }
    if (Math.abs(m - c.ref) <= 0.55) {
      c.sum += m;
      c.n++;
      c.away = 0;
      c.ref = c.sum / c.n;
      if (!c.on && t - c.t0 >= 0.12) c.on = true;
    } else {
      c.away = c.away || t;
      if (t - c.away >= 0.08) {
        if (c.on) endNote(c, t);
        L.cand = { ref: m, t0: t, away: 0, on: false, sum: m, n: 1 };
      }
    }
  }
  function endNote(c, t) {
    const n = { p: Math.round(c.sum / c.n), t0: c.t0, t1: t };
    n.name = noteName(n.p);
    live.notes.push(n);
    if (live.notes.length > 24) live.notes.shift();
    if (api.onNote) api.onNote(n);
  }

  // ---- drawing
  const X = (t) => HX - (tNow - t) * speed;
  const Y = (v) => cy - v * amp;
  function path(key, from = -Infinity, to = Infinity) {
    g.beginPath();
    let on = false;
    for (const s of tape) {
      if (s.t < from || s.t > to) continue;
      const v = s[key];
      if (v == null) {
        on = false;
        continue;
      }
      const x = X(s.t);
      if (x < -sw * 2) continue;
      if (on) g.lineTo(x, Y(v));
      else {
        g.moveTo(x, Y(v));
        on = true;
      }
    }
  }
  function strand(key, color) {
    path(key);
    g.strokeStyle = color;
    g.lineWidth = sw;
    g.stroke();
  }
  function draw() {
    state.frames++;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // 1. the strands. Cool first, warm on top; then at each crossing where it's the agent's turn, cut a gap in the
    //    warm strand along the cool one and lay the cool one back over it (the mark's mask, done live).
    strand('c', C.agent);
    strand('w', C.human);
    const half = (sw * 2.1) / speed;
    let shown = 0;
    for (const k of crossings) {
      const x = X(k.t);
      if (x < -sw * 3 || x > HX + sw) continue;
      shown++;
      const top = k.over === 'warm' ? 'w' : 'c',
        color = k.over === 'warm' ? C.human : C.agent;
      g.globalCompositeOperation = 'destination-out';
      g.lineCap = 'butt';
      path(top, k.t - half, k.t + half);
      g.lineWidth = sw * 1.62;
      g.stroke();
      g.globalCompositeOperation = 'source-over';
      path(top, k.t - half - DT, k.t + half + DT);
      g.lineWidth = sw;
      g.strokeStyle = color;
      g.stroke();
      g.lineCap = 'round';
    }
    state.crossings = shown;
    // the oldest tape fades out at the left edge
    g.globalCompositeOperation = 'destination-out';
    const fw = Math.min(160, W * 0.16),
      fade = g.createLinearGradient(0, 0, fw, 0);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, fw, H);

    // 2. behind the strands: the tape's grid (bar lines scroll with it, the centre line holds still)
    g.globalCompositeOperation = 'destination-over';
    g.lineWidth = 1;
    const b0 = Math.floor((tNow - HX / speed) / BEAT) - 1,
      b1 = Math.ceil((tNow + (W - HX) / speed) / BEAT) + 1;
    for (let b = b0; b <= b1; b++) {
      const x = Math.round(X(b * BEAT)) + 0.5,
        bar = b % 4 === 0;
      if (x < 0 || x > W) continue;
      g.strokeStyle = bar ? C.line2 : C.line;
      g.globalAlpha = x > HX ? 0.45 : 1;
      g.beginPath();
      g.moveTo(x, bar ? 14 : cy - amp * 1.2);
      g.lineTo(x, bar ? H - 4 : cy + amp * 1.2);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.strokeStyle = C.line;
    g.setLineDash([2, 6]);
    for (const v of [-1, 1]) {
      g.beginPath();
      g.moveTo(0, Math.round(Y(v)) + 0.5);
      g.lineTo(W, Math.round(Y(v)) + 0.5);
      g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = C.line2;
    g.beginPath();
    g.moveTo(0, Math.round(cy) + 0.5);
    g.lineTo(W, Math.round(cy) + 0.5);
    g.stroke();
    g.globalCompositeOperation = 'source-over';

    // bar numbers along the top edge, like a timeline
    g.font = `600 ${W < 600 ? 11 : 12}px ${C.mono}`;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillStyle = C.text3;
    for (let b = Math.floor(b0 / 4) * 4; b <= b1; b += 4) {
      const x = X(b * BEAT);
      if (x < 4 || x > W - 20) continue;
      g.globalAlpha = x > HX ? 0.5 : Math.min(1, x / (W * 0.16));
      g.fillText(String(b / 4 + 1), x + 6, 2);
    }
    g.globalAlpha = 1;

    // 3. the record head: the playhead, and the two pens
    g.fillStyle = C.accent;
    g.strokeStyle = C.accent;
    g.shadowColor = C.accent;
    g.shadowBlur = 10;
    g.fillRect(HX - 1, 6, 2, H - 10);
    g.shadowBlur = 0;
    g.beginPath();
    g.moveTo(HX - 6, 4);
    g.lineTo(HX + 6, 4);
    g.lineTo(HX, 11);
    g.closePath();
    g.fill();
    const last = tape[tape.length - 1];
    const tags = [];
    if (last) {
      if (last.w != null)
        tags.push({ y: Y(last.w), color: C.human, text: state.mode === 'live' ? 'you, live' : 'you' });
      tags.push({ y: Y(last.c), color: C.agent, text: 'your agent' });
      for (const t of tags) {
        g.fillStyle = t.color;
        g.beginPath();
        g.arc(HX, t.y, sw * 0.62, 0, 6.283);
        g.fill();
        g.fillStyle = C.bg;
        g.beginPath();
        g.arc(HX, t.y, sw * 0.22, 0, 6.283);
        g.fill();
      }
      // labels right of the head, kept apart when the strands meet
      const fs = W < 600 ? 13 : 14;
      g.font = `700 ${fs}px ${C.ui}`;
      g.textBaseline = 'middle';
      tags.sort((a, b) => a.y - b.y);
      const gap = fs * 1.9;
      if (tags.length === 2 && tags[1].y - tags[0].y < gap) {
        const m = (tags[0].y + tags[1].y) / 2;
        tags[0].ly = m - gap / 2;
        tags[1].ly = m + gap / 2;
      }
      for (const t of tags) {
        const ly = Math.max(fs, Math.min(H - fs, t.ly ?? t.y)),
          lx = HX + sw * 0.62 + 12;
        const tw = g.measureText(t.text).width;
        g.fillStyle = C.bg;
        g.globalAlpha = 0.86;
        roundRect(lx - 6, ly - fs * 0.85, tw + 12, fs * 1.7, 2);
        g.fill();
        g.globalAlpha = 1;
        g.fillStyle = t.color;
        g.fillText(t.text, lx, ly + 0.5);
      }
    }
  }
  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // (a reduced-motion still lands a quarter bar after a crossing, where the two pens are furthest apart)
  api.frame = (now) => {
    if (!W) return;
    const t = now / 1000;
    if (tStart == null) {
      tStart = t;
      tNow = BAR * (reduced ? 8.25 : 6);
      prefill(tNow);
      clockAt = t;
    }
    if (!reduced || state.mode === 'live') {
      // a hidden tab or a long frame doesn't fast-forward the tape: at most a tenth of a second per frame
      tNow += Math.min(0.1, Math.max(0, t - clockAt));
      advance(tNow);
    }
    clockAt = t;
    draw();
  };

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();
  api.resize = resize;
  api.recolor = () => {
    readColors();
    if (state.frames) draw();
  };
  return api;
}
