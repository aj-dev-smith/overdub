// Studio A's window (core.drumroom names `editor: 'drumroom'`): the kit drawn as it stands in the room, played by
// clicking where you'd hit it, each piece's own controls beside it, and the mic mix as a console's channel strips.
// The contract is ui/plugin.js's (docs/ARCHITECTURE.md, "Device windows"): mount(el, ctx) -> { update, frame, unmount }.
//
// The drawing. Every piece stands where the kernel's mics hear it (devices/builtin/drumroom.js LAYOUT: one layout for
// the picture and the stereo image), at its kit's sizes and in its finish (LOOKS below; the cymbal sizes are the
// kernel's own), seen from above the drummer's seat. VIEW AUDIENCE turns it round, as it turns the stereo picture.
// Line and type: hairlines on the room's ground, wood and bronze kept quiet, labels in the UI face, the mics as small
// marks (solid while their fader is up, dashed while it's off). The shaker, the claps, the crush mic and the room pair
// stand further out than the page, so they sit past a break line with their distances.
//
// Playing it. A click or a tap plays the piece where you hit it, through engine.liveNoteOn (the keyboard strip's path:
// heard, not recorded): the snare's middle, edge or rim (a rimshot); the hats' tip or edge; the ride's bell, bow or
// edge. Alt plays the other stroke: a cymbal's choke, the snare's side stick, the hats' pedal (Alt on the hat pedal is
// the foot splash); a finger or a pen kept on a cymbal for HOLD ms closes a hand on it (its choke): a touch has no Alt.
// How hard: where you hit inside that ring, lower is louder, as on the keyboard strip (0.2 at the top of the ring
// to 1 at its bottom). On the hats, a drag up opens them (an open stroke) and letting go closes them with the foot. The
// kick is its shell where the toms leave it showing, and the floor before it from the pedal across to floor tom 1; a
// piece's name, where it is drawn, plays the piece too. Each piece is also a button laid over the drawing (it takes no
// pointer: the drawing does): Tab reaches the kit, the arrow keys walk it, Enter or Space plays a piece, Alt+Enter its
// other stroke. The keys beside the kit play every way to hit the selected piece (hold Roll to roll).
//
// Lights. A piece lights when the song plays it (the track's notes between one frame's playhead and the next, read
// with engine/schedule.js notesIn, so muted clips and tracks stay dark), when you play it, and when MIDI or musical
// typing plays the track (app.input 'note'). The light is cream, with a ring in the ink of whoever wrote the note (the
// house's notes are unsigned), and it fades as the piece rings (its kit's decay times the DECAY knobs); a choke or a
// closing hat cuts it. An agent's change flashes the piece it touched with crop marks in cool ink, and the control it
// turned flashes as every window control does.
//
// app.drumroom, while the window is open: { selected, select(piece), point(piece, { zone, at }), hit(x, y),
// name(piece), lit(piece), flashing(target), hat(), view, look } (tools/drumroom-ui-test.js holds the window to all of
// the above).

import { h, css, clamp, tok } from '../dom.js';
import { NOTE_MAP, PIECES, KITS, LAYOUT } from '../../devices/builtin/drumroom.js';
import { notesIn } from '../../engine/schedule.js';

const IN = 0.0254;
const DRUMS = ['snare', 'tom1', 'tom2', 'tom3', 'tom4'];
const CYMS = ['crash1', 'crash2', 'ride', 'china', 'splash'];
const PERC = ['tamb', 'cowbell', 'shaker', 'clap'];
const OUT_FRONT = ['shaker', 'clap'];
const NAME = {
  kick: 'Kick',
  snare: 'Snare',
  hat: 'Hi-hat',
  tom1: 'Rack tom 1',
  tom2: 'Rack tom 2',
  tom3: 'Floor tom 1',
  tom4: 'Floor tom 2',
  crash1: 'Crash 1',
  crash2: 'Crash 2',
  ride: 'Ride',
  china: 'China',
  splash: 'Splash',
  tamb: 'Tambourine',
  cowbell: 'Cowbell',
  shaker: 'Shaker',
  clap: 'Claps',
};
const SHORT = {
  tom1: 'T1',
  tom2: 'T2',
  tom3: 'T3',
  tom4: 'T4',
  crash1: 'C1',
  crash2: 'C2',
  splash: 'Spl',
  tamb: 'Tamb',
  cowbell: 'Cow',
  china: 'Chi',
};
// the stroke a plain click plays, and the one Alt plays
const MAIN = {
  kick: 36,
  snare: 38,
  hat: 42,
  tom1: 50,
  tom2: 47,
  tom3: 45,
  tom4: 43,
  crash1: 49,
  crash2: 57,
  ride: 51,
  china: 52,
  splash: 55,
  tamb: 54,
  cowbell: 56,
  shaker: 70,
  clap: 39,
};
const ALT = { snare: 37, hat: 44, crash1: 27, crash2: 28, ride: 25, china: 29, splash: 30 };
// how long a finger (or a pen) stays on a cymbal before the hand closes on it, its choke (ms)
const HOLD = 350;
const PIECE_OF = Object.fromEntries(NOTE_MAP.map(([p, piece]) => [p, piece]));
const ART_OF = Object.fromEntries(NOTE_MAP.map(([p, , art]) => [p, art]));
// what each stroke is called, and where to hit for it
const WORD = {
  snare: {
    center: ['Center', 'the middle'],
    edge: ['Edge', 'near the rim'],
    rimshot: ['Rimshot', 'the rim'],
    sidestick: ['Side stick', 'Alt'],
    flam: ['Flam', ''],
    drag: ['Drag', ''],
    roll: ['Roll', 'hold it'],
  },
  hat: {
    tip: ['Closed', 'the middle'],
    edge: ['Closed edge', 'the edge'],
    quarter: ['¼ open', ''],
    half: ['½ open', ''],
    open: ['Open', 'drag up'],
    openedge: ['Open edge', 'drag up on the edge'],
    pedal: ['Pedal', 'the pedal'],
    splash: ['Foot splash', 'Alt on the pedal'],
  },
  ride: {
    bow: ['Bow', 'the middle of it'],
    bell: ['Bell', 'the bell'],
    edge: ['Edge', 'the edge'],
    choke: ['Choke', 'Alt', 'hold it'],
  },
  cym: { hit: ['Hit', ''], choke: ['Choke', 'Alt', 'hold it'] },
  other: { hit: ['Hit', ''] },
};
const ART_RANK = [
  'center',
  'tip',
  'bow',
  'hit',
  'bell',
  'edge',
  'rimshot',
  'sidestick',
  'quarter',
  'half',
  'open',
  'openedge',
  'pedal',
  'splash',
  'flam',
  'drag',
  'roll',
  'choke',
];
const wordOf = (piece, p) => {
  const table = WORD[piece] || (CYMS.includes(piece) ? WORD.cym : WORD.other);
  return table[ART_OF[p]] || ['Hit', ''];
};
// a piece's notes, its main stroke first
const notesOf = (piece) =>
  NOTE_MAP.filter((r) => r[1] === piece)
    .map((r) => r[0])
    .sort((a, b) =>
      a === MAIN[piece]
        ? -1
        : b === MAIN[piece]
          ? 1
          : ART_RANK.indexOf(ART_OF[a]) - ART_RANK.indexOf(ART_OF[b]) || a - b,
    );
// "38 center, 34 edge, 40 rimshot ..." ("50, 48" where every note is the same plain hit)
const notesText = (piece) =>
  notesOf(piece)
    .map((p) => {
      const w = wordOf(piece, p)[0];
      return w === 'Hit' ? String(p) : `${p} ${w.toLowerCase()}`;
    })
    .join(', ');

// The kits as drawn: sizes (inches; the cymbals' are the kernel's KITS), the finish, the heads, the beater, and how
// long each piece rings (the kernel's T60s, seconds) for the lights.
const LOOKS = [
  {
    line: 'Warm 70s maple, deep and round: coated heads and a felt beater.',
    finish: 'maple',
    wood: '#c48b4c',
    grain: '#8e5c2e',
    heads: 'coated',
    beater: 'felt',
    bronze: '#b98b3f',
    kick: [22, 16],
    snare: [14, 6.5],
    toms: [10, 12, 14, 16],
    hat: 14,
    cym: [16, 18, 20, 18, 10],
    t60: {
      kick: 0.32,
      snare: 0.2,
      toms: [0.75, 0.85, 1.0, 1.2],
      open: 1.6,
      closed: 0.07,
      cym: [3.2, 3.8, 5.5, 2.5, 1.3],
    },
  },
  {
    line: 'Punchy modern birch, bright and focused: clear heads and a plastic beater.',
    finish: 'birch',
    wood: '#d6bd90',
    grain: '#a68a5c',
    heads: 'clear',
    beater: 'plastic',
    bronze: '#c99f48',
    kick: [22, 18],
    snare: [14, 5.5],
    toms: [10, 12, 14, 16],
    hat: 14,
    cym: [17, 18, 21, 18, 10],
    t60: {
      kick: 0.26,
      snare: 0.18,
      toms: [0.6, 0.7, 0.85, 1.0],
      open: 1.8,
      closed: 0.06,
      cym: [3.4, 3.8, 5.5, 2.6, 1.3],
    },
  },
  {
    line: 'A small kit tuned up: open heads, and thin dark cymbals that ring long.',
    finish: 'walnut',
    wood: '#7a4f2f',
    grain: '#4f321d',
    heads: 'coated',
    beater: 'felt',
    bronze: '#927140',
    kick: [18, 14],
    snare: [14, 5],
    toms: [10, 12, 13, 14],
    hat: 14,
    cym: [16, 18, 20, 16, 8],
    t60: {
      kick: 0.75,
      snare: 0.24,
      toms: [1.0, 1.1, 1.3, 1.5],
      open: 2.2,
      closed: 0.09,
      cym: [3.0, 4.0, 7.0, 2.2, 1.0],
    },
  },
  {
    line: 'A big rock kit in a big room: deep toms, a wood beater and big bright cymbals.',
    finish: 'oxblood lacquer',
    wood: '#80302a',
    grain: null,
    heads: 'clear',
    beater: 'wood',
    bronze: '#d4aa50',
    kick: [24, 18],
    snare: [14, 8],
    toms: [12, 13, 16, 18],
    hat: 15,
    cym: [18, 19, 22, 20, 10],
    t60: {
      kick: 0.4,
      snare: 0.28,
      toms: [1.0, 1.15, 1.4, 1.7],
      open: 2.3,
      closed: 0.08,
      cym: [4.5, 4.8, 6.0, 3.0, 1.4],
    },
  },
  {
    line: 'A dry 70s kit with towels on the heads: low, short and dark.',
    finish: 'faded maple',
    wood: '#a06f40',
    grain: '#6f4a28',
    heads: 'coated',
    towels: true,
    beater: 'felt',
    bronze: '#8f7044',
    kick: [22, 14],
    snare: [14, 6.5],
    toms: [12, 13, 16, 18],
    hat: 14,
    cym: [15, 16, 20, 16, 8],
    t60: {
      kick: 0.17,
      snare: 0.09,
      toms: [0.28, 0.32, 0.38, 0.45],
      open: 1.1,
      closed: 0.05,
      cym: [2.0, 2.4, 3.5, 1.6, 0.9],
    },
  },
];
export const KIT_LOOKS = LOOKS; // (the checks hold the cymbal sizes to the kernel's)
const PERC_T60 = { tamb: 0.3, cowbell: 0.45, shaker: 0.15, clap: 0.18 };
const HAT_OPEN = { tip: 0, edge: 0, pedal: 0, quarter: 0.25, half: 0.5, open: 1, openedge: 1, splash: 0.6 };

// The page: world metres (the drummer's view), the band past the break line for what stands further out. It stops
// just behind the front of the drummer's seat, so the kit, not the floor, takes the window's height.
const FRAME = { x0: -1.02, x1: 1.34, y0: -0.4, y1: 1.17, yb: 1.02 };
const FW = FRAME.x1 - FRAME.x0,
  FH = FRAME.y1 - FRAME.y0;
const CX = (FRAME.x0 + FRAME.x1) / 2,
  CY = (FRAME.y0 + FRAME.y1) / 2;
const BAND_Y = { shaker: 1.068, clap: 1.068, crush: 1.068, room: 1.068 };
const fmtIn = (x) => (Number.isInteger(x) ? String(x) : x === 6.5 ? '6½' : x === 5.5 ? '5½' : String(x));

let mounted = 0;
export function mount(el, ctx) {
  css('plugin-drumroom', CSS);
  const { app, def } = ctx;
  const track = ctx.addr.track;
  const uid = ++mounted;
  ctx.keyboard?.show?.(false); // the drawn kit is the instrument here
  const coarse = () => {
    try {
      return matchMedia('(pointer: coarse)').matches;
    } catch {
      return false;
    }
  };
  const reduced = () => {
    try {
      return matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  };

  /* ================================================================ state */
  let P = ctx.params();
  let kitI = clamp(Math.round(P.kit || 0), 0, LOOKS.length - 1);
  let look = LOOKS[kitI];
  let selected = null; // a piece, or null: the whole kit
  let hover = null; // { piece, zone, note, v }
  let micHi = null; // a mic strip hovered or focused: 'close' 'oh' 'room' 'crush' 'bleed' 'size'
  let hatOpen = 0,
    hatHeld = 0; // how open the hats are (0..1), as the last stroke left them; held by a drag
  let lastHit = null; // { piece, note, v } (a touch has no hover: the caption says what it played)
  const lights = new Map(); // piece -> { v, t0, tau, ink, cut }
  const flashes = new Map(); // piece | 'stage' | mic -> until (ms)
  const pointers = new Map(); // pointerId -> { piece, zone, note, v, x0, y0, at, opened, hold, grabbed }
  const tags = new Map(); // piece -> its name as last drawn, [x0, y0, x1, y1] metres (a click there plays it)
  const named = new Map(); // piece -> its name as last drawn, { x, y, w, h } stage px (for the checks)
  const artKeys = []; // the keys beside the kit: every way to play the selected piece
  const keyNotes = new Map(); // piece -> the note Enter or Space holds on its button
  let theta = (P.view | 0) === 1 ? Math.PI : 0,
    thetaFrom = theta,
    thetaTo = theta,
    thetaAt = 0;
  let animating = false; // the drawing redraws every frame while something moves (a light, a flash, the turn)
  let pal = colors();

  function colors() {
    const t = (n, d) => tok(n) || d;
    return {
      bg: t('--bg', '#141210'),
      panel: t('--panel', '#1d1b17'),
      bg3: t('--bg-3', '#24211c'),
      line: t('--line', '#2f2b25'),
      line2: t('--line-2', '#46413a'),
      text: t('--text', '#f4ead6'),
      text2: t('--text-2', '#cbc0aa'),
      text3: t('--text-3', '#9a8f7c'),
      agent: t('--agent', '#4cc3ff'),
      human: t('--human', '#ffa043'),
      accent2: t('--accent-2', '#f1dc8a'),
      ui: t('--font-ui', 'system-ui, sans-serif'),
      mono: t('--font-mono', 'ui-monospace, monospace'),
    };
  }

  /* ================================================================ geometry (world metres) */
  const POS = (piece) => LAYOUT.pieces[piece];
  // each piece's shape: circles (drums, cymbals, hats, percussion), the kick a rectangle with its pedal, the hats'
  // pedal; r is the radius that's hit (the hoop's outside for a drum)
  function shapes() {
    const L = look,
      out = {};
    const [kx, ky, kz] = POS('kick'),
      kw = L.kick[0] * IN,
      kd = L.kick[1] * IN;
    out.kick = {
      piece: 'kick',
      type: 'kick',
      x: kx,
      y: ky,
      z: kz,
      w: kw,
      d: kd,
      rect: [kx - kw / 2, ky - kd / 2, kx + kw / 2, ky + kd / 2],
      pedal: [kx - 0.045, ky - kd / 2 - 0.3, kx + 0.045, ky - kd / 2],
      r: Math.max(kw, kd) / 2,
    };
    DRUMS.forEach((piece, i) => {
      const [x, y, z] = POS(piece),
        dia = piece === 'snare' ? L.snare[0] : L.toms[i - 1];
      out[piece] = {
        piece,
        type: 'drum',
        x,
        y,
        z,
        head: (dia * IN) / 2,
        r: (dia * IN) / 2 + 0.012,
        dia,
        depth: piece === 'snare' ? L.snare[1] : null,
      };
    });
    CYMS.forEach((piece, i) => {
      const [x, y, z] = POS(piece);
      out[piece] = { piece, type: 'cym', x, y, z, r: (L.cym[i] * IN) / 2, dia: L.cym[i] };
    });
    {
      const [x, y, z] = POS('hat');
      out.hat = {
        piece: 'hat',
        type: 'hat',
        x,
        y,
        z,
        r: (L.hat * IN) / 2,
        dia: L.hat,
        pedal: [x - 0.045, y - 0.42, x + 0.045, y - 0.07],
      };
    }
    {
      const [x, y, z] = POS('tamb');
      out.tamb = { piece: 'tamb', type: 'tamb', x, y, z, r: 0.115 };
    }
    {
      const [x, y, z] = POS('cowbell');
      out.cowbell = { piece: 'cowbell', type: 'cowbell', x, y, z, r: 0.07 };
    }
    for (const piece of OUT_FRONT) {
      const [x, y, z] = POS(piece);
      out[piece] = { piece, type: piece, x, y: BAND_Y[piece], realY: y, z: 3 + z, r: 0.07 };
    }
    // The kick's foot: the floor before its batter head, from the pedal across to floor tom 1. The toms cover most of
    // the shell, so this is the kick you can see to hit, and its name sits on it, close to the hoop.
    {
      const k = out.kick,
        q = k.rect,
        ft = out.tom3,
        right = Math.min(q[2], ft.x - ft.r - 0.005);
      k.foot = [k.x - 0.07, k.pedal[1], right, q[1]];
      k.tag = [(k.pedal[2] + right) / 2, q[1] - 0.09];
    }
    return out;
  }
  let S = shapes();
  // drawn (and hit) bottom to top; out-front things last
  let ORDER = Object.values(S)
    .sort((a, b) => a.z - b.z)
    .map((x) => x.piece);
  const relook = () => {
    S = shapes();
    ORDER = Object.values(S)
      .sort((a, b) => a.z - b.z)
      .map((x) => x.piece);
  };

  /* ================================================================ the screen: world <-> CSS px (turned by theta) */
  const stageBox = { w: 0, h: 0 };
  function T(w = stageBox.w, hh = stageBox.h) {
    const s = Math.min(w / FW, hh / FH);
    return { s, w, h: hh, c: Math.cos(theta), n: Math.sin(theta) };
  }
  const toS = (t, x, y) => {
    const dx = x - CX,
      dy = y - CY;
    return [t.w / 2 + (dx * t.c - dy * t.n) * t.s, t.h / 2 - (dx * t.n + dy * t.c) * t.s];
  };
  const toW = (t, X, Y) => {
    const rx = (X - t.w / 2) / t.s,
      ry = -(Y - t.h / 2) / t.s;
    return [CX + rx * t.c + ry * t.n, CY - rx * t.n + ry * t.c];
  };
  // (for a pointer or a key: the stage as it is laid out now, drawn or not)
  const Tnow = () => {
    const r = stage.getBoundingClientRect();
    return T(r.width, r.height);
  };

  /* ================================================================ the DOM */
  const root = h('div.dr', { dataset: { kit: KITS[kitI] } });
  const stage = h('div.dr-stage');
  stage.style.setProperty('--dr-ar', (FW / FH).toFixed(4)); // (the page's shape; h()'s style object can't set a --var)
  const cv = ctx.kit.canvas({
    className: 'dr-cv',
    label: `${def.name}: the kit drawn from above, where each piece stands`,
    draw: (g, o) => draw(g, o),
    animate: () => animating,
  });
  stage.append(cv.el);
  const cap = h('p.dr-cap');
  const left = h('div.dr-left', stage, cap);
  // a button over each piece, for the keyboard and screen readers (the drawing takes the pointer)
  const pcBtn = {};
  for (const piece of PIECES) {
    const b = h('button.dr-pc', { type: 'button', tabindex: -1, dataset: { piece } });
    b.addEventListener('keydown', (e) => pieceKey(e, piece));
    b.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        stopKeyNote(piece);
      }
    });
    b.addEventListener('click', (e) => {
      if (e.detail === 0 && !keyNotes.has(piece)) {
        playNote(MAIN[piece], 0.8);
        release(MAIN[piece]);
      }
    }); // (assistive tech clicks)
    b.addEventListener('focus', () => {
      select(piece, { from: 'focus' });
      say();
    });
    b.addEventListener('blur', () => {
      stopKeyNote(piece);
      say();
    });
    pcBtn[piece] = b;
    stage.append(b);
  }

  // the kit picker: what each kit is, in a line
  const kitLine = h('p.dr-kitline');
  const kitCtl = ctx.control('kit', { label: false });
  const kitBox = h('div.dr-kit', h('span.dr-lbl', 'Kit'), kitCtl, kitLine);
  kitCtl?.querySelectorAll('.pk-seg-b').forEach((b, i) => {
    const show = () => {
      kitLine.textContent = LOOKS[i].line;
      kitLine.classList.toggle('dr-preview', i !== kitI);
    };
    const back = () => {
      kitLine.textContent = look.line;
      kitLine.classList.remove('dr-preview');
    };
    b.title = LOOKS[i].line;
    b.addEventListener('pointerenter', show);
    b.addEventListener('pointerleave', back);
    b.addEventListener('focus', show);
    b.addEventListener('blur', back);
  });
  kitLine.textContent = look.line;

  // what's selected: the whole kit, a piece, or the percussion
  const side = h('div.dr-side', kitBox);
  const panels = {};
  const metaEls = {};
  const knob = (key, label, aria) => {
    const c = ctx.control(key, key === 'hat_model' ? { kind: 'select', label } : { size: 48, label }); // a switch: a select keeps the row one line
    const d = c?.querySelector('[role=slider]');
    if (d && aria) d.setAttribute('aria-label', aria);
    return c;
  };
  function panel(id, title, keys, notes) {
    const hid = `dr-h-${uid}-${id}`;
    const meta = h('span.dr-sel-m');
    metaEls[id] = meta;
    const whole =
      id === 'kit'
        ? null
        : h(
            'button.btn.btn-txt.dr-whole',
            { type: 'button', onclick: () => select(null, { focus: false }) },
            'Whole kit',
          );
    const head = h('header.dr-sel-h', h('h3', { id: hid }, title), meta, whole);
    const knobs = h(
      'div.dr-knobs',
      keys.map(([k, label, aria]) => knob(k, label, aria)),
    );
    const arts = notes.length
      ? h(
          'div.dr-arts',
          { role: 'group', 'aria-label': `${title}: every way to play it` },
          notes.map(([p, piece]) => artKey(p, piece)),
        )
      : null;
    const sec = h(
      'section.dr-sel',
      { 'aria-labelledby': hid, hidden: true, dataset: { panel: id } },
      head,
      knobs,
      arts,
    );
    panels[id] = sec;
    side.append(sec);
  }
  panel(
    'kit',
    `${def.name}, the whole kit`,
    [
      ['tune', 'TUNE', `${def.name} tune, every piece`],
      ['decay', 'DECAY', `${def.name} decay, every piece`],
      ['humanize', 'HUMAN', `${def.name} humanize`],
      ['velocity', 'VEL', `${def.name} velocity curve`],
    ],
    [],
  );
  // the cymbal model, with the whole kit (CLASSIC is the kit's own cymbals; FDN and MODAL the new ones)
  panels.kit.append(h('div.dr-kit.dr-cym', h('span.dr-lbl', 'Cymbals'), ctx.control('cym_model', { label: false })));
  for (const piece of PIECES) {
    if (PERC.includes(piece)) continue;
    const nm = NAME[piece];
    const keys = [
      [`${piece}_tune`, 'TUNE', `${nm} tune`],
      [`${piece}_decay`, 'DECAY', `${nm} decay`],
      [`${piece}_level`, 'LEVEL', `${nm} level`],
    ];
    if (piece === 'snare') keys.push(['snare_wires', 'WIRES', 'Snare wires']);
    if (piece === 'hat') keys.push(['hat_model', 'MODEL', 'Hi-hat model']);
    panel(
      piece,
      nm,
      keys,
      notesOf(piece).map((p) => [p, piece]),
    );
  }
  panel(
    'perc',
    'Percussion',
    [['perc_level', 'LEVEL', 'Percussion level: tambourine, cowbell, shaker and claps']],
    PERC.flatMap((piece) => notesOf(piece).map((p) => [p, piece])),
  );

  // the mic mix: a channel strip for each bus, the view, the output
  const STRIPS = [
    ['mix_close', 'close', 'Close mics'],
    ['mix_oh', 'oh', 'Overheads'],
    ['mix_room', 'room', 'Room pair'],
    ['mix_crush', 'crush', 'Crushed room'],
    ['bleed', 'bleed', 'Mic leak'],
    ['room_size', 'size', 'Room size'],
  ];
  const strips = h('div.dr-strips');
  for (const [key, bus, sub] of STRIPS) {
    const c = ctx.control(key, { kind: 'slider', orient: 'v', length: 112 });
    const s = h('div.dr-strip', { dataset: { bus } }, c, h('span.dr-strip-sub', sub));
    const on = () => {
        micHi = bus;
        cv.dirty();
      },
      off = () => {
        if (micHi === bus) {
          micHi = null;
          cv.dirty();
        }
      };
    s.addEventListener('pointerenter', on);
    s.addEventListener('pointerleave', off);
    s.addEventListener('focusin', on);
    s.addEventListener('focusout', off);
    strips.append(s);
  }
  strips.append(
    h('div.dr-strip.dr-view', ctx.control('view'), h('span.dr-strip-sub', 'Stereo from the seat or out front')),
  );
  const meter = ctx.kit.meter({
    label: `${def.name} output level`,
    read: () => ctx.meter.level(),
    orient: 'v',
    length: 80,
  });
  strips.append(
    h('div.dr-strip.dr-out', h('span.pk-l', h('span.pk-l-t', 'OUT')), meter.el, h('span.dr-strip-sub', 'Its output')),
  );
  const mix = h(
    'section.dr-mix',
    { 'aria-label': `${def.name} mic mix` },
    h('div.dr-mix-h', h('span.dr-mix-t', 'Mics'), h('span.dr-mix-s', 'Each mic in the mix; down at −40 dB it is off.')),
    strips,
  );

  root.append(h('div.dr-main', left, side), mix);
  el.append(root);

  /* ================================================================ the articulation keys (the selected piece) */
  function artKey(p, piece) {
    const [word, how, byHand] = wordOf(piece, p);
    const b = h(
      'button.dr-art',
      {
        type: 'button',
        dataset: { note: String(p), piece },
        'aria-label': `${NAME[piece]}${PERC.includes(piece) || word === 'Hit' ? '' : ', ' + word.toLowerCase()}: note ${p}`,
      },
      h('span.dr-art-n', String(p)),
      h('span.dr-art-w', PERC.includes(piece) ? NAME[piece] : word),
      how ? h('span.dr-art-h', { dataset: /\bAlt\b/.test(how) ? { alt: '' } : {} }, how) : null,
      byHand ? h('span.dr-art-h', { dataset: { touch: '' } }, byHand) : null,
    );
    let held = null;
    const down = () => {
      if (held != null) return;
      held = p;
      b.classList.add('on');
      playNote(p, 0.8);
      lastHit = { piece, note: p, v: 0.8 };
      say();
    };
    const up = () => {
      if (held == null) return;
      release(held);
      held = null;
      b.classList.remove('on');
    };
    b.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* gone */
      }
      down();
    });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        down();
      }
    });
    b.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        up();
      }
    });
    b.addEventListener('blur', up);
    b.addEventListener('click', (e) => {
      if (e.detail === 0 && held == null) {
        down();
        up();
      }
    });
    artKeys.push(b);
    return b;
  }

  /* ================================================================ playing */
  function playNote(p, v) {
    try {
      app.engine.liveNoteOn(track, p, clamp(v, 0.05, 1));
    } catch {
      /* no audio yet */
    }
    strike(PIECE_OF[p] || 'snare', p, v, 'you');
  }
  function release(p) {
    try {
      app.engine.liveNoteOff(track, p);
    } catch {
      /* ok */
    }
  }
  // a light: how long it shows is how long the piece rings
  function ringOf(piece, p) {
    const L = look.t60,
      dk = (+P.decay || 1) * (+P[piece + '_decay'] || 1);
    let t;
    if (piece === 'kick') t = L.kick;
    else if (piece === 'snare') t = L.snare * 1.8;
    else if (piece.startsWith('tom')) t = L.toms[+piece[3] - 1];
    else if (piece === 'hat') {
      const o = HAT_OPEN[ART_OF[p]] ?? 0;
      t = L.closed * Math.pow(L.open / L.closed, Math.pow(o, 0.65));
    } else if (CYMS.includes(piece)) t = L.cym[CYMS.indexOf(piece)];
    else return Math.max(0.09, PERC_T60[piece] || 0.2);
    return clamp((t * dk) / 4, 0.09, 3.5);
  }
  function strike(piece, p, v, by) {
    const now = performance.now();
    const art = ART_OF[p];
    lights.set(piece, {
      v: clamp(v, 0.15, 1),
      t0: now,
      tau: ringOf(piece, p),
      by,
      cut: art === 'choke' ? now + 110 : 0,
    });
    if (piece === 'hat') {
      hatOpen = HAT_OPEN[art] ?? 0;
      if (hatOpen === 0) {
        const l = lights.get('hat');
        if (l) l.tau = ringOf('hat', 42);
      }
    }
    animate();
  }
  const level = (piece, now = performance.now()) => {
    const l = lights.get(piece);
    if (!l) return 0;
    const tau = l.cut && now > l.cut ? 0.03 : l.tau;
    const from = l.cut && now > l.cut ? l.cut : l.t0;
    const base = l.cut && now > l.cut ? l.v * Math.exp(-(l.cut - l.t0) / 1000 / l.tau) : l.v;
    const x = base * Math.exp(-(now - from) / 1000 / tau);
    if (x < 0.004) {
      lights.delete(piece);
      return 0;
    }
    return x;
  };

  /* ================================================================ hit testing */
  // -> { piece, zone, note, v } for a point in the stage (CSS px), or null. Velocity: where it lands inside the ring it
  // hit, lower louder (the ring's top 0.2, its bottom 1).
  function hitAt(X, Y, { touch = coarse(), alt = false } = {}) {
    const t = Tnow();
    if (!t.s) return null;
    const [x, y] = toW(t, X, Y);
    const halo = touch ? 22 / t.s : 3 / t.s; // a finger's reach (44 px across); a mouse's slack
    for (let i = ORDER.length - 1; i >= 0; i--) {
      const sh = S[ORDER[i]];
      const r = inShape(sh, x, y, halo, t);
      if (r) return finish(sh, r, X, Y, t, alt);
    }
    return null;
  }
  const inRect = (q, x, y, m = 0) => x >= q[0] - m && x <= q[2] + m && y >= q[1] - m && y <= q[3] + m;
  // a piece's name, where it is drawn, plays the piece too (the cowbell's sits above it, a cymbal's can reach past its
  // edge)
  const onName = (sh, x, y) => {
    const b = tags.get(sh.piece);
    return b && inRect(b, x, y) ? { zone: 'name', box: b } : null;
  };
  function inShape(sh, x, y, halo) {
    if (sh.type === 'kick') {
      if (inRect(sh.foot, x, y, halo)) return { zone: 'pedal', box: sh.foot };
      if (inRect(sh.rect, x, y, halo * 0.5)) return { zone: 'shell', box: sh.rect };
      return onName(sh, x, y);
    }
    const d = Math.hypot(x - sh.x, y - sh.y);
    if (d <= Math.max(sh.r, halo) + (halo < sh.r ? halo * 0.3 : 0)) {
      const f = d / sh.r;
      if (sh.type === 'drum' && sh.piece === 'snare')
        return f < 0.6 ? { zone: 'center', rz: 0.6 } : f < 0.86 ? { zone: 'edge', rz: 0.86 } : { zone: 'rim', rz: 1 };
      if (sh.type === 'hat') return f < 0.72 ? { zone: 'tip', rz: 0.72 } : { zone: 'edge', rz: 1 };
      if (sh.piece === 'ride')
        return f < 0.24 ? { zone: 'bell', rz: 0.24 } : f < 0.84 ? { zone: 'bow', rz: 0.84 } : { zone: 'edge', rz: 1 };
      return { zone: 'hit', rz: 1 };
    }
    if (sh.type === 'hat' && inRect(sh.pedal, x, y, halo)) return { zone: 'pedal', box: sh.pedal };
    return onName(sh, x, y);
  }
  const ZONE_NOTE = {
    snare: { center: 38, edge: 34, rim: 40 },
    hat: { tip: 42, edge: 22, pedal: 44 },
    ride: { bell: 53, bow: 51, edge: 59 },
  };
  function finish(sh, r, X, Y, t, alt) {
    let top, bottom;
    if (r.box) {
      const a = toS(t, r.box[0], r.box[1]),
        b = toS(t, r.box[2], r.box[3]);
      top = Math.min(a[1], b[1]);
      bottom = Math.max(a[1], b[1]);
    } else {
      const [, cy] = toS(t, sh.x, sh.y),
        rz = Math.max(r.rz * sh.r * t.s, 8);
      top = cy - rz;
      bottom = cy + rz;
    }
    const f = clamp((Y - top) / Math.max(1, bottom - top), 0, 1);
    // (a name is no place on the piece: it plays a plain stroke, as Enter on the piece does)
    const v = r.zone === 'name' ? 0.8 : +(0.2 + 0.8 * f).toFixed(3);
    let note = ZONE_NOTE[sh.piece]?.[r.zone] ?? MAIN[sh.piece];
    if (alt) note = sh.piece === 'hat' && r.zone === 'pedal' ? 21 : (ALT[sh.piece] ?? note);
    return { piece: sh.piece, zone: r.zone, note, v };
  }
  const v127 = (v) => Math.round(clamp(v, 0, 1) * 127);

  /* ================================================================ the pointer on the drawing */
  const local = (e) => {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const [X, Y] = local(e);
    const hit = hitAt(X, Y, { touch: e.pointerType === 'touch' || e.pointerType === 'pen', alt: e.altKey });
    if (!hit) {
      if (e.pointerType !== 'touch') select(null, { focus: false });
      return;
    }
    e.preventDefault();
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* gone */
    }
    playNote(hit.note, hit.v);
    lastHit = hit;
    // a finger (or a pen) left on a cymbal is a hand closing on it: once it has stayed HOLD ms, its choke (frame())
    const hold = e.pointerType !== 'mouse' && CYMS.includes(hit.piece) && hit.note !== ALT[hit.piece];
    pointers.set(e.pointerId, {
      ...hit,
      x0: e.clientX,
      y0: e.clientY,
      at: performance.now(),
      opened: false,
      touch: e.pointerType === 'touch',
      hold,
      grabbed: null,
    });
    select(hit.piece, { focus: false });
    hover = e.pointerType === 'touch' ? null : hit;
    say();
  });
  stage.addEventListener('pointermove', (e) => {
    const pr = pointers.get(e.pointerId);
    if (pr) {
      if (pr.hold && Math.hypot(e.clientX - pr.x0, e.clientY - pr.y0) > 16) pr.hold = false; // (a swipe, not a hold)
      // the hats: a drag up opens them (the foot lifts: an open stroke); letting go closes them with the foot
      if (pr.piece === 'hat' && pr.zone !== 'pedal' && !pr.opened && pr.y0 - e.clientY >= (pr.touch ? 22 : 14)) {
        pr.opened = true;
        const p = pr.zone === 'edge' ? 26 : 46;
        playNote(p, Math.max(0.45, pr.v));
        pr.open = p;
        hatHeld = 1;
        lastHit = { piece: 'hat', zone: 'open', note: p, v: Math.max(0.45, pr.v) };
        say();
      }
      return;
    }
    if (e.pointerType === 'touch') return;
    const [X, Y] = local(e);
    const hit = hitAt(X, Y, { touch: false, alt: e.altKey });
    const key = hit ? `${hit.piece}:${hit.zone}:${hit.note}:${hit.v}` : '';
    if (key !== (hover ? `${hover.piece}:${hover.zone}:${hover.note}:${hover.v}` : '')) {
      hover = hit;
      say();
      cv.dirty();
    }
    stage.style.cursor = hit ? 'pointer' : 'default';
  });
  const lift = (e) => {
    const pr = pointers.get(e.pointerId);
    if (!pr) return;
    pointers.delete(e.pointerId);
    release(pr.note);
    if (pr.grabbed != null) release(pr.grabbed);
    if (pr.opened) {
      release(pr.open);
      hatHeld = 0;
      playNote(44, 0.55);
      release(44);
      lastHit = { piece: 'hat', zone: 'pedal', note: 44, v: 0.55 };
      say();
    }
  };
  // the hand closes on a held cymbal: its choke note, played light (the kernel's choke is a stroke, then the grab 110 ms
  // on; the stroke under the ringing cymbal is the hand meeting it), and its light goes with the ring
  function grab(pr) {
    const p = ALT[pr.piece];
    pr.grabbed = p;
    try {
      app.engine.liveNoteOn(track, p, 0.05);
    } catch {
      /* no audio yet */
    }
    const l = lights.get(pr.piece);
    if (l && !l.cut) l.cut = performance.now() + 110;
    lastHit = { piece: pr.piece, zone: 'choke', note: p, v: 0.05 };
    say();
    animate();
  }
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);
  stage.addEventListener('lostpointercapture', lift);
  stage.addEventListener('pointerleave', () => {
    if (hover) {
      hover = null;
      say();
      cv.dirty();
    }
  });
  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const [X, Y] = local(e);
    const hit = hitAt(X, Y, { touch: false });
    if (hit) select(hit.piece, { focus: false });
  });

  /* ================================================================ the keyboard on a piece */
  function pieceKey(e, piece) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || keyNotes.has(piece)) return;
      const p = e.altKey && ALT[piece] ? ALT[piece] : MAIN[piece];
      keyNotes.set(piece, p);
      playNote(p, 0.8);
      lastHit = { piece, note: p, v: 0.8 };
      say();
      return;
    }
    const d = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      e.preventDefault();
      e.stopPropagation();
      const to = nearest(piece, d);
      if (to) pcBtn[to].focus();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      pcBtn[e.key === 'Home' ? 'kick' : 'clap'].focus();
    }
  }
  function stopKeyNote(piece) {
    const p = keyNotes.get(piece);
    if (p == null) return;
    keyNotes.delete(piece);
    release(p);
  }
  // the piece the arrow points at, on screen: the closest one that way, a sideways step costing more
  function nearest(from, [dx, dy]) {
    const t = Tnow();
    const [x0, y0] = anchor(from, t);
    let best = null,
      bs = Infinity;
    for (const piece of PIECES) {
      if (piece === from) continue;
      const [x, y] = anchor(piece, t),
        ux = x - x0,
        uy = y - y0;
      const along = ux * dx + uy * dy,
        across = Math.abs(ux * dy - uy * dx);
      if (along <= 4) continue;
      const score = along + across * 2.2;
      if (score < bs) {
        bs = score;
        best = piece;
      }
    }
    return best;
  }
  // where a piece is on screen: the middle of what you'd hit (the kick's pedal side: its toms cover the rest)
  function anchor(piece, t = T()) {
    const sh = S[piece];
    if (sh.type === 'kick') {
      const q = sh.pedal;
      return toS(t, (q[0] + q[2]) / 2, (q[1] + sh.rect[1]) / 2 + 0.06);
    }
    return toS(t, sh.x, sh.y);
  }

  /* ================================================================ selection, the caption */
  function select(piece, { focus = false, from = null } = {}) {
    if (piece && !S[piece]) piece = null;
    const changed = piece !== selected;
    selected = piece;
    const id = !piece ? 'kit' : PERC.includes(piece) ? 'perc' : piece;
    for (const [k, sec] of Object.entries(panels)) sec.hidden = k !== id;
    for (const b of artKeys) b.classList.toggle('dr-art-this', !!piece && b.dataset.piece === piece);
    // one stop for the kit in the Tab order: the selected piece (the snare when the whole kit is)
    const stop = piece || 'snare';
    for (const [k, b] of Object.entries(pcBtn)) b.tabIndex = k === stop ? 0 : -1;
    if (focus && piece) pcBtn[piece].focus({ preventScroll: true });
    if (changed) {
      cv.dirty();
      if (from !== 'focus') say();
    }
  }
  const zoneWord = (hit) => {
    if (!hit) return '';
    const w = wordOf(hit.piece, hit.note)[0].toLowerCase();
    return w === 'hit' ? '' : w;
  };
  function say() {
    const focusPiece = Object.entries(pcBtn).find(([, b]) => b === document.activeElement)?.[0] || null;
    const hit = hover || (pointers.size ? [...pointers.values()].pop() : null);
    if (hit) {
      const zw = zoneWord(hit);
      cap.replaceChildren(
        h('b', NAME[hit.piece]),
        `${zw ? ', ' + zw : ''}: note ${hit.note}, velocity ${v127(hit.v)}. Plays ${notesText(hit.piece)}.`,
      );
    } else if (focusPiece) {
      cap.replaceChildren(
        h('b', NAME[focusPiece]),
        `: plays ${notesText(focusPiece)}. Enter plays it${ALT[focusPiece] ? `, Alt+Enter the ${wordOf(focusPiece, ALT[focusPiece])[0].toLowerCase()}` : ''}; the arrow keys move to the next piece.`,
      );
    } else if (lastHit && coarse()) {
      const zw = zoneWord(lastHit);
      cap.replaceChildren(
        h('b', NAME[lastHit.piece]),
        `${zw ? ', ' + zw : ''}: note ${lastHit.note}, velocity ${v127(lastHit.v)}. Plays ${notesText(lastHit.piece)}.`,
      );
    } else {
      cap.textContent = coarse()
        ? 'Tap a piece where you’d hit it: the middle, near the edge or the rim. Lower on a piece is louder. Press and hold a cymbal to choke it; drag up on the hats to open them. The keys below play every stroke.'
        : 'Click a piece where you’d hit it: the middle, near the edge or the rim. Lower on a piece is louder. Alt-click chokes a cymbal; drag up on the hats to open them and let go to close them.';
    }
  }

  /* ================================================================ placing the buttons */
  function place() {
    const t = T(100, (100 * FH) / FW); // (percentages of the stage)
    for (const piece of PIECES) {
      const sh = S[piece],
        b = pcBtn[piece],
        [x, y] = anchor(piece, t);
      let w, hh;
      if (sh.type === 'kick') {
        w = sh.w * t.s;
        hh = (sh.d / 2 + 0.3) * t.s;
      } else {
        w = hh = 2 * sh.r * t.s;
      }
      const turned = Math.abs(Math.sin(theta)) > 0.7;
      Object.assign(b.style, {
        left: x + '%',
        top: (y / t.h) * 100 + '%',
        width: (turned ? hh : w) + '%',
        height: ((turned ? w : hh) / t.h) * 100 + '%',
      });
      const sz = sh.type === 'kick' ? `${look.kick[0]} by ${look.kick[1]} inch` : sh.dia ? `${sh.dia} inch` : '';
      b.setAttribute('aria-label', `${NAME[piece]}${sz ? ', ' + sz : ''}: plays ${notesText(piece)}`);
    }
  }

  /* ================================================================ params from the song */
  function sync(keys = null) {
    P = ctx.params();
    const k = clamp(Math.round(P.kit || 0), 0, LOOKS.length - 1);
    if (k !== kitI) {
      kitI = k;
      look = LOOKS[k];
      relook();
      root.dataset.kit = KITS[k];
      if (!kitLine.classList.contains('dr-preview')) kitLine.textContent = look.line;
      metas();
      place();
    }
    const to = (P.view | 0) === 1 ? Math.PI : 0;
    if (to !== thetaTo) {
      thetaFrom = theta;
      thetaTo = to;
      thetaAt = performance.now();
      if (reduced()) {
        theta = to;
        place();
      }
      animate();
    }
    if (!keys || keys.length) cv.dirty();
  }
  function metas() {
    const heads = look.heads === 'clear' ? 'clear heads' : look.towels ? 'coated heads, towels on' : 'coated heads';
    const cymName = { crash1: 'crash', crash2: 'crash', ride: 'ride', china: 'china', splash: 'splash' };
    metaEls.kit.textContent = `${KITS[kitI].toLowerCase()}: ${look.kick[0]}″ kick, ${look.snare[0]}″ snare, ${look.toms.join(' ')} toms, ${look.cym[2]}″ ride`;
    for (const piece of PIECES) {
      if (!metaEls[piece]) continue;
      const sh = S[piece];
      metaEls[piece].textContent =
        piece === 'kick'
          ? `${look.kick[0]} × ${look.kick[1]}, ${look.finish}, ${look.beater} beater`
          : piece === 'snare'
            ? `${look.snare[0]} × ${fmtIn(look.snare[1])}, ${look.finish}, ${heads}`
            : sh.type === 'drum'
              ? `${sh.dia}″, ${look.finish}, ${heads}`
              : piece === 'hat'
                ? `${look.hat}″ pair`
                : `${sh.dia}″ ${cymName[piece] || ''}`.trim();
    }
    metaEls.perc.textContent = 'tambourine, cowbell, shaker and claps: one level';
  }
  metas();
  place();
  select(null);
  say();

  /* ================================================================ who changed what: an agent's flash */
  const PIECE_KEYS = new Map();
  for (const p of def.params || []) {
    if (PIECES.includes(p.group)) PIECE_KEYS.set(p.key, [p.group]);
    else if (p.group === 'perc') PIECE_KEYS.set(p.key, PERC);
  }
  const MIC_KEYS = {
    mix_close: 'close',
    bleed: 'close',
    mix_oh: 'oh',
    mix_room: 'room',
    room_size: 'room',
    mix_crush: 'crush',
  };
  const offOn = ctx.on((evt) => {
    sync(evt.keys);
    if (evt.kind !== 'do' || !ctx.isAgent(evt.by)) return;
    const until = performance.now() + 1700;
    for (const k of evt.keys || []) {
      for (const piece of PIECE_KEYS.get(k) || []) flashes.set(piece, until);
      if (MIC_KEYS[k]) flashes.set(MIC_KEYS[k], until);
      if (['kit', 'tune', 'decay', 'humanize', 'velocity', 'view'].includes(k)) flashes.set('stage', until);
    }
    animate();
  });
  // MIDI and musical typing on this track light it too
  const offNote =
    app.input?.on?.('note', (n) => {
      if (n && n.on && n.track === track) strike(PIECE_OF[n.p] || 'snare', n.p, n.v ?? 0.8, 'you');
    }) || null;

  /* ================================================================ the song: what it plays lights the kit */
  let lastBeat = null,
    lastGen = null;
  function scan() {
    const e = app.engine;
    if (!e || !e.playing) {
      lastBeat = null;
      return;
    }
    const beat = e.beat;
    if (!Number.isFinite(beat)) return;
    if (lastBeat == null || e.gen !== lastGen) {
      lastBeat = beat;
      lastGen = e.gen;
      return;
    }
    const p = app.store.get();
    const t = p.tracks.find((x) => x.id === track);
    const solo = p.tracks.some((x) => x.solo);
    const heard = t && !t.mute && (!solo || t.solo);
    const run = (a, b) => {
      if (heard && b > a)
        for (const n of notesIn(p, a, b, { tracks: [track] }))
          strike(
            PIECE_OF[n.note.p] || 'snare',
            n.note.p,
            n.note.v ?? 0.8,
            n.note.by || t.clips.find((c) => c.id === n.clip)?.by || null,
          );
    };
    if (beat < lastBeat - 1e-6) {
      // a loop going round: the end of the loop, then its start
      if (p.loop?.on && Number.isFinite(+p.loop.end)) {
        run(lastBeat, +p.loop.end);
        run(+p.loop.start || 0, beat);
      }
    } else if (beat - lastBeat <= 2) run(lastBeat, beat);
    lastBeat = beat;
  }

  /* ================================================================ the loop */
  function animate() {
    animating = true;
    cv.dirty();
  }
  function frame(now) {
    scan();
    for (const pr of pointers.values()) if (pr.hold && pr.grabbed == null && now - pr.at >= HOLD) grab(pr);
    if (thetaTo !== theta) {
      const k = clamp((now - thetaAt) / 220, 0, 1),
        e = 1 - Math.pow(1 - k, 3);
      theta = thetaFrom + (thetaTo - thetaFrom) * e;
      if (k >= 1) {
        theta = thetaTo;
        place();
      }
    }
    for (const [k, until] of flashes) if (now > until) flashes.delete(k);
    let lit = false;
    for (const piece of [...lights.keys()]) if (level(piece, now) > 0) lit = true;
    animating = lit || flashes.size > 0 || thetaTo !== theta || hatHeld > 0;
  }

  /* ================================================================ drawing */
  function draw(g, { w, h: hh, now }) {
    stageBox.w = w;
    stageBox.h = hh;
    const t = T(w, hh);
    const s = t.s;
    const small = s < 190; // (a phone's width)
    const F = (px, weight = 600, face = pal.ui) => `${weight} ${Math.max(small ? 12 : 10, px)}px ${face}`;
    const circ = (x, y, r) => {
      const [X, Y] = toS(t, x, y);
      g.beginPath();
      g.arc(X, Y, Math.max(0.5, r * s), 0, Math.PI * 2);
    };
    const poly = (pts) => {
      g.beginPath();
      pts.forEach(([x, y], i) => {
        const [X, Y] = toS(t, x, y);
        if (i) g.lineTo(X, Y);
        else g.moveTo(X, Y);
      });
      g.closePath();
    };
    const rect = (q) =>
      poly([
        [q[0], q[1]],
        [q[2], q[1]],
        [q[2], q[3]],
        [q[0], q[3]],
      ]);
    const line = (x0, y0, x1, y1) => {
      const a = toS(t, x0, y0),
        b = toS(t, x1, y1);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
    };
    const ink = (c, a = 1) => {
      g.globalAlpha = a;
      g.strokeStyle = c;
    };
    const fill = (c, a = 1) => {
      g.globalAlpha = a;
      g.fillStyle = c;
    };
    const text = (
      str,
      x,
      y,
      { font = F(11), color = pal.text2, align = 'center', plate = false, base = 'middle', dy = 0 } = {},
    ) => {
      let [X, Y] = toS(t, x, y);
      Y += dy;
      g.font = font;
      g.textAlign = align;
      g.textBaseline = base;
      if (align === 'center') {
        const half = g.measureText(str).width / 2 + 3;
        X = clamp(X, half, w - half);
      }
      // over a cymbal's grooves: the letters knocked out of the room's ground, no box
      if (plate) {
        g.globalAlpha = 0.92;
        g.strokeStyle = pal.bg;
        g.lineWidth = 4;
        g.lineJoin = 'round';
        g.strokeText(str, X, Y);
        g.lineWidth = 1;
      }
      fill(color, 1);
      g.fillText(str, X, Y);
      return [X, Y, g.measureText(str).width];
    };
    // a piece's name: drawn, and kept where it landed (in metres, so a click on it plays the piece; in px, for the checks)
    tags.clear();
    named.clear();
    const nameIt = (piece, str, x, y, o) => {
      const [X, Y, tw] = text(str, x, y, o),
        px = parseFloat(/([\d.]+)px/.exec(o.font)[1]);
      named.set(piece, { x: X, y: Y, w: tw, h: px });
      const c = [
        [X - tw / 2 - 2, Y - px / 2 - 2],
        [X + tw / 2 + 2, Y - px / 2 - 2],
        [X - tw / 2 - 2, Y + px / 2 + 2],
        [X + tw / 2 + 2, Y + px / 2 + 2],
      ].map(([a, b]) => toW(t, a, b));
      tags.set(piece, [
        Math.min(...c.map((q) => q[0])),
        Math.min(...c.map((q) => q[1])),
        Math.max(...c.map((q) => q[0])),
        Math.max(...c.map((q) => q[1])),
      ]);
    };
    const fits = (str, font, px) => {
      g.font = font;
      return g.measureText(str).width <= px;
    };
    // a label's place on its piece: the first of `cands` (offsets in radii) that nothing higher covers
    const under = (o, x, y) =>
      o.type === 'kick' ? inRect(o.rect, x, y) || inRect(o.pedal, x, y) : Math.hypot(x - o.x, y - o.y) < o.r + 0.008;
    const spot = (sh, cands, hw, hh) => {
      for (const [fx, fy] of cands) {
        const x = sh.x + fx * sh.r,
          y = sh.y + fy * sh.r;
        const pts = [
          [x, y],
          [x - hw, y - hh],
          [x + hw, y - hh],
          [x - hw, y + hh],
          [x + hw, y + hh],
        ];
        if (!Object.values(S).some((o) => o.z > sh.z && pts.some(([px, py]) => under(o, px, py)))) return [x, y];
      }
      return [sh.x + cands[0][0] * sh.r, sh.y + cands[0][1] * sh.r];
    };
    const SPOTS = [
      [0, 0],
      [0, -0.42],
      [0, 0.42],
      [-0.4, 0],
      [0.4, 0],
      [-0.3, -0.32],
      [0.3, -0.32],
      [-0.3, 0.32],
      [0.3, 0.32],
    ];
    g.lineWidth = 1;
    g.lineCap = 'round';

    // the page: which way we look and the scale in the two corners by the drummer, the break line, what stands past it
    {
      g.globalAlpha = 1;
      const turned = Math.cos(theta) < 0;
      const [tx, ty] = toS(t, FRAME.x0 + 0.03, FRAME.y0 + 0.03);
      g.font = F(11, 600);
      g.textAlign = turned ? 'right' : 'left';
      g.textBaseline = turned ? 'top' : 'bottom';
      fill(pal.text3);
      g.fillText(
        small
          ? turned
            ? 'Audience’s view'
            : 'Drummer’s view'
          : turned
            ? 'The audience’s view, from above'
            : 'The drummer’s view, from above',
        tx,
        ty,
      );
      // half a metre
      const [bx, by] = toS(t, FRAME.x1 - 0.03, FRAME.y0 + 0.05),
        bl = 0.5 * s,
        dir = turned ? 1 : -1;
      ink(pal.text3, 0.9);
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + dir * bl, by);
      g.moveTo(bx, by - 4);
      g.lineTo(bx, by + 1);
      g.moveTo(bx + dir * bl, by - 4);
      g.lineTo(bx + dir * bl, by + 1);
      g.stroke();
      g.font = F(10, 400, pal.mono);
      g.textAlign = turned ? 'left' : 'right';
      g.textBaseline = turned ? 'top' : 'bottom';
      fill(pal.text3);
      g.fillText('0.5 m', bx, turned ? by + 5 : by - 5);
      // the break: two zigzags across
      ink(pal.line2, 1);
      for (const off of [-0.012, 0.012]) {
        g.beginPath();
        const n = 28;
        for (let i = 0; i <= n; i++) {
          const x = FRAME.x0 + (FW * i) / n,
            y = FRAME.yb + off + (i % 2 ? 0.01 : -0.01);
          const [X, Y] = toS(t, x, y);
          if (i) g.lineTo(X, Y);
          else g.moveTo(X, Y);
        }
        g.stroke();
      }
      if (!small) text('not to scale', 0.72, BAND_Y.room + 0.045, { font: F(10, 400), color: pal.text3 });
    }
    // the drummer's seat
    {
      ink(pal.line2);
      circ(0.02, -0.5, 0.17);
      g.stroke();
      circ(0.02, -0.5, 0.012);
      fill(pal.line2);
      g.fill();
      if (!small) text('Drummer', 0.02, -0.372, { font: F(10, 400), color: pal.text3 });
    }

    // the tom holder on the kick
    {
      const a = S.tom1,
        b = S.tom2;
      ink(pal.line2);
      line(a.x, a.y, S.kick.x, S.kick.y + 0.04);
      g.stroke();
      line(b.x, b.y, S.kick.x, S.kick.y + 0.04);
      g.stroke();
    }

    const lightsOn = new Map();
    for (const piece of PIECES) {
      const L = level(piece, now);
      if (L > 0) lightsOn.set(piece, L);
    }
    const ringInk = (piece) => {
      const l = lights.get(piece);
      if (!l || !l.by || l.by === 'overdub') return null;
      return ctx.isAgent(l.by) ? pal.agent : pal.human;
    };

    for (const piece of ORDER) drawPiece(S[piece], lightsOn.get(piece) || 0);

    function lugs(sh, n, rad, size = 0.024) {
      for (let k = 0; k < n; k++) {
        const a = (k + 0.5) * ((2 * Math.PI) / n),
          x = sh.x + Math.cos(a) * rad,
          y = sh.y + Math.sin(a) * rad;
        const [X, Y] = toS(t, x, y),
          q = size * s;
        fill(pal.text3, 0.85);
        g.fillRect(X - q / 2, Y - q / 2, q, q);
      }
    }
    function head(sh, L) {
      const r = sh.head;
      // the shell's finish just outside the hoop, the hoop, the head
      circ(sh.x, sh.y, r + 0.02);
      fill(look.wood, 0.95);
      g.fill();
      lugs(sh, sh.dia >= 13 ? 8 : 6, r + 0.02, 0.022);
      circ(sh.x, sh.y, r + 0.011);
      fill('#8d877b', 1);
      g.fill();
      circ(sh.x, sh.y, r + 0.011);
      ink(pal.text2, 0.9);
      g.stroke();
      circ(sh.x, sh.y, r);
      fill(pal.bg, 1);
      g.fill();
      if (look.heads === 'clear') {
        circ(sh.x, sh.y, r);
        fill(pal.text, 0.04);
        g.fill();
        circ(sh.x, sh.y, r * 0.93);
        ink(pal.text3, 0.55);
        g.setLineDash([2, 3]);
        g.stroke();
        g.setLineDash([]);
      } else {
        circ(sh.x, sh.y, r);
        fill('#e9dec4', 0.14);
        g.fill();
        circ(sh.x, sh.y, r * 0.965);
        ink(pal.text3, 0.4);
        g.stroke();
      }
      if (look.towels && sh.piece !== 'snare') {
        const tw = r * 0.95,
          th = r * 0.55,
          yo = sh.y - r * 0.2;
        poly([
          [sh.x - tw * 0.8, yo - th / 2],
          [sh.x + tw * 0.75, yo - th / 2 - 0.01],
          [sh.x + tw * 0.82, yo + th / 2],
          [sh.x - tw * 0.7, yo + th / 2 + 0.01],
        ]);
        fill('#d8ccb2', 0.2);
        g.fill();
        ink('#d8ccb2', 0.35);
        g.stroke();
        line(sh.x - tw * 0.5, yo - th / 2, sh.x - tw * 0.4, yo + th / 2);
        g.stroke();
      }
      if (look.towels && sh.piece === 'snare') {
        poly([
          [sh.x - r * 0.1, sh.y + r * 0.95],
          [sh.x + r * 0.72, sh.y + r * 0.55],
          [sh.x + r * 0.95, sh.y + r * 0.15],
          [sh.x + r * 0.25, sh.y + r * 0.3],
        ]);
        fill('#d8ccb2', 0.22);
        g.fill();
        ink('#d8ccb2', 0.35);
        g.stroke();
      }
      if (L > 0) {
        circ(sh.x, sh.y, r);
        fill(pal.text, 0.86 * L);
        g.fill();
      }
    }
    // a cymbal: a line drawing in bronze ink, the lathe's grooves as hairlines, the bell, the hole and its felt
    function cymbal(sh, L, { bell = 0.2, china = false } = {}) {
      const br = look.bronze;
      circ(sh.x, sh.y, sh.r);
      fill(pal.bg, 1);
      g.fill();
      circ(sh.x, sh.y, sh.r);
      fill(br, 0.14);
      g.fill();
      if (L > 0) {
        circ(sh.x, sh.y, sh.r);
        fill(pal.text, 0.42 * L);
        g.fill();
      }
      const step = Math.max(2.4, 0.011 * s) / s;
      for (let r = sh.r * bell + step, k = 0; r < sh.r - step * 0.4; r += step, k++) {
        circ(sh.x, sh.y, r);
        ink(br, k % 4 === 0 ? 0.5 : 0.24);
        g.stroke();
      }
      if (china) {
        circ(sh.x, sh.y, sh.r * 0.86);
        ink(br, 0.85);
        g.stroke();
        circ(sh.x, sh.y, sh.r * 0.9);
        ink(br, 0.5);
        g.stroke();
      }
      const q = sh.r * bell;
      if (china) {
        const [X, Y] = toS(t, sh.x, sh.y);
        fill(pal.bg, 1);
        g.fillRect(X - q * s, Y - q * s, 2 * q * s, 2 * q * s);
        fill(br, L > 0 ? 0.3 + 0.6 * L : 0.3);
        g.fillRect(X - q * s, Y - q * s, 2 * q * s, 2 * q * s);
        ink(br, 0.9);
        g.strokeRect(X - q * s, Y - q * s, 2 * q * s, 2 * q * s);
      } else {
        circ(sh.x, sh.y, q);
        fill(pal.bg, 1);
        g.fill();
        circ(sh.x, sh.y, q);
        fill(br, 0.3);
        g.fill();
        if (L > 0) {
          circ(sh.x, sh.y, q);
          fill(pal.text, 0.7 * L);
          g.fill();
        }
        circ(sh.x, sh.y, q * 0.62);
        ink(br, 0.6);
        g.stroke();
        circ(sh.x, sh.y, q);
        ink(br, 0.95);
        g.stroke();
      }
      circ(sh.x, sh.y, 0.013);
      fill('#0c0a08', 1);
      g.fill();
      circ(sh.x, sh.y, 0.013);
      ink('#e9dec4', 0.55);
      g.stroke();
      circ(sh.x, sh.y, sh.r);
      ink(br, 1);
      g.stroke();
    }
    function drawPiece(sh, L) {
      g.globalAlpha = 1;
      const off = +P[sh.piece + '_level'] <= -39.9 || (PERC.includes(sh.piece) && +P.perc_level <= -39.9);
      if (sh.type === 'kick') {
        const q = sh.rect,
          hoop = 0.032;
        rect(q);
        fill(pal.bg, 1);
        g.fill();
        rect(q);
        fill(look.wood, 0.72);
        g.fill();
        if (look.grain) {
          ink(look.grain, 0.5);
          for (let k = 1; k < 9; k++) {
            const y = q[1] + (q[3] - q[1]) * (k / 9) + (k % 2 ? 0.004 : -0.003);
            line(q[0] + 0.02, y, q[2] - 0.02, y + 0.004);
            g.stroke();
          }
        }
        for (const yy of [q[1], q[3] - hoop]) {
          rect([q[0] - 0.006, yy, q[2] + 0.006, yy + hoop]);
          fill(look.grain || '#3c1410', 1);
          g.fill();
          ink(pal.text3, 0.7);
          g.stroke();
        }
        for (let k = 0; k < 6; k++) {
          const x = q[0] + (q[2] - q[0]) * ((k + 0.5) / 6);
          for (const yy of [q[1] + hoop, q[3] - hoop]) {
            const [X, Y] = toS(t, x, yy),
              z = 0.02 * s;
            fill(pal.text3, 0.85);
            g.fillRect(X - z / 2, Y - z / 2, z, z);
          }
        }
        // spurs at the front, the pedal and its beater at the back (the drummer's side)
        ink(pal.text3, 0.8);
        line(q[0], q[3] - 0.08, q[0] - 0.09, q[3] + 0.02);
        g.stroke();
        line(q[2], q[3] - 0.08, q[2] + 0.09, q[3] + 0.02);
        g.stroke();
        const pd = sh.pedal;
        rect(pd);
        fill('#3a3631', 1);
        g.fill();
        ink(pal.text2, 0.8);
        g.stroke();
        line(pd[0] + 0.012, pd[1] + 0.05, pd[2] - 0.012, pd[1] + 0.05);
        g.stroke();
        circ(sh.x, q[1] + hoop + 0.03, 0.03);
        fill(look.beater === 'felt' ? '#e2d6bb' : look.beater === 'plastic' ? '#1c1a17' : '#b88a52', 1);
        g.fill();
        ink(pal.text2, 0.8);
        g.stroke();
        rect(q);
        ink(pal.text2, 0.85);
        g.stroke();
        if (L > 0) {
          rect(q);
          fill(pal.text, 0.55 * L);
          g.fill();
          rect(pd);
          fill(pal.text, 0.85 * L);
          g.fill();
        }
        // its name on its foot, clear of floor tom 1 (a big kit's leaves less room: the size then crosses the pedal,
        // knocked out of it)
        const size = `${look.kick[0]} × ${look.kick[1]}`,
          ft = S.tom3;
        g.font = F(10, 400, pal.mono);
        const sw = small ? 0 : g.measureText(size).width;
        g.font = F(11);
        const hw = (Math.max(sw, g.measureText('Kick').width) / 2 + 2) / s;
        const ly = sh.tag[1],
          lx = Math.min(sh.tag[0], ft.x - ft.r - hw);
        nameIt('kick', 'Kick', lx, ly, { font: F(11), color: pal.text, dy: small ? 0 : -6 });
        if (!small) text(size, lx, ly, { font: F(10, 400, pal.mono), color: pal.text3, dy: 8, plate: lx - hw < pd[2] });
      } else if (sh.type === 'drum') {
        if (sh.piece === 'tom3' || sh.piece === 'tom4') {
          ink(pal.line2, 1);
          for (let k = 0; k < 3; k++) {
            const a = Math.PI / 2 + (k * 2 * Math.PI) / 3 + 0.4,
              r0 = sh.head + 0.03;
            line(
              sh.x + Math.cos(a) * r0,
              sh.y + Math.sin(a) * r0,
              sh.x + Math.cos(a) * (r0 + 0.08),
              sh.y + Math.sin(a) * (r0 + 0.08),
            );
            g.stroke();
          }
        }
        if (sh.piece === 'snare') {
          // the throw-off on the drummer's right
          const [X, Y] = toS(t, sh.x + sh.head + 0.03, sh.y - 0.02),
            z = 0.026 * s;
          fill(pal.text3, 0.9);
          g.fillRect(X - z / 2, Y - z, z, z * 2);
        }
        head(sh, L);
        const name = small
          ? fits(NAME[sh.piece], F(11), sh.head * 2 * s * 0.86)
            ? NAME[sh.piece]
            : SHORT[sh.piece] || NAME[sh.piece]
          : NAME[sh.piece];
        const lit = L > 0.45;
        const size = sh.piece === 'snare' ? `${sh.dia} × ${fmtIn(sh.depth)}` : `${sh.dia}″`;
        const one = small && sh.head * 2 * s < 64;
        g.font = F(11);
        const hw = (g.measureText(name).width / 2 + 3) / s;
        const [lx, ly] = spot(sh, SPOTS, hw, one ? 0.03 : 0.06);
        if (one) nameIt(sh.piece, name, lx, ly, { font: F(11), color: lit ? pal.bg : pal.text });
        else {
          nameIt(sh.piece, name, lx, ly, { font: F(11), color: lit ? pal.bg : pal.text, dy: -6 });
          text(size, lx, ly, { font: F(10, 400, pal.mono), color: lit ? pal.bg : pal.text3, dy: 8 });
        }
      } else if (sh.type === 'hat') {
        // the pedal, the tripod's feet, the top plate
        const pd = sh.pedal;
        ink(pal.line2);
        for (let k = 0; k < 3; k++) {
          const a = -Math.PI / 2 + Math.PI / 3 + (k * 2 * Math.PI) / 3;
          line(
            sh.x + Math.cos(a) * (sh.r - 0.02),
            sh.y + Math.sin(a) * (sh.r - 0.02),
            sh.x + Math.cos(a) * (sh.r + 0.09),
            sh.y + Math.sin(a) * (sh.r + 0.09),
          );
          g.stroke();
        }
        rect(pd);
        fill('#3a3631', 1);
        g.fill();
        ink(pal.text2, 0.8);
        g.stroke();
        line(pd[0] + 0.012, pd[1] + 0.05, pd[2] - 0.012, pd[1] + 0.05);
        g.stroke();
        cymbal(sh, L, { bell: 0.28 });
        // the clutch on the rod
        {
          const [X, Y] = toS(t, sh.x, sh.y),
            z = Math.max(4, 0.03 * s);
          ink(pal.text2, 0.9);
          g.strokeRect(X - z / 2, Y - z / 2, z, z);
        }
        nameIt('hat', small ? 'Hat' : `Hi-hat ${sh.dia}″`, sh.x, sh.y - sh.r * 0.55, {
          font: F(11),
          color: L > 0.45 ? pal.bg : pal.text,
          plate: L <= 0.45,
        });
        // a side view of the pair beside it: how open they are
        const gx = sh.x - sh.r - 0.12,
          gy = sh.y - 0.1,
          open = Math.max(hatOpen, hatHeld),
          gap = 0.004 + open * 0.03,
          half = 0.07;
        const [X, Y] = toS(t, gx, gy),
          hw = half * s,
          gp = gap * s,
          dip = 0.012 * s;
        ink(pal.text2, 0.9);
        g.beginPath();
        g.moveTo(X - hw, Y - gp / 2);
        g.lineTo(X, Y - gp / 2 - dip);
        g.lineTo(X + hw, Y - gp / 2);
        g.stroke();
        g.beginPath();
        g.moveTo(X - hw, Y + gp / 2);
        g.lineTo(X, Y + gp / 2 + dip);
        g.lineTo(X + hw, Y + gp / 2);
        g.stroke();
        ink(pal.line2, 1);
        g.beginPath();
        g.moveTo(X, Y - gp / 2 - dip - 6);
        g.lineTo(X, Y + gp / 2 + dip + 8);
        g.stroke();
        g.font = F(10, 400, pal.mono);
        g.textAlign = 'center';
        g.textBaseline = 'top';
        fill(pal.text3);
        g.fillText(
          open >= 0.95 ? 'open' : open >= 0.45 ? '½ open' : open > 0.1 ? '¼ open' : 'closed',
          X,
          Y + gp / 2 + dip + 10,
        );
      } else if (sh.type === 'cym') {
        cymbal(sh, L, {
          bell: sh.piece === 'ride' ? 0.24 : sh.piece === 'splash' ? 0.3 : 0.2,
          china: sh.piece === 'china',
        });
        const where = {
          crash1: [-0.12, 0.45],
          crash2: [0.12, 0.45],
          ride: [-0.3, 0.52],
          china: [0.22, -0.48],
          splash: [0, 0.6],
        }[sh.piece];
        const label = small ? SHORT[sh.piece] || NAME[sh.piece] : `${NAME[sh.piece]} ${sh.dia}″`;
        g.font = F(11);
        const hw = (g.measureText(label).width / 2 + 4) / s;
        const [lx, ly] = spot(
          sh,
          [where, [0, -0.55], [-0.5, 0.2], [0.5, 0.2], [0, 0.6], [-0.45, -0.35], [0.45, -0.35]],
          hw,
          0.035,
        );
        nameIt(sh.piece, label, lx, ly, { font: F(11), color: L > 0.45 ? pal.bg : pal.text, plate: L <= 0.45 });
      } else if (sh.type === 'tamb') {
        // on the hat stand: a ring and its jingles
        ink(pal.line2);
        line(sh.x, sh.y, S.hat.x, S.hat.y);
        g.stroke();
        circ(sh.x, sh.y, sh.r);
        fill('#2a2520', 1);
        g.fill();
        circ(sh.x, sh.y, sh.r);
        ink(look.wood, 1);
        g.lineWidth = Math.max(2, 0.014 * s);
        g.stroke();
        g.lineWidth = 1;
        for (let k = 0; k < 5; k++) {
          const a = (k + 0.5) * ((2 * Math.PI) / 5),
            x = sh.x + Math.cos(a) * sh.r,
            y = sh.y + Math.sin(a) * sh.r;
          circ(x, y, 0.016);
          fill('#c9c0ad', 0.9);
          g.fill();
        }
        if (L > 0) {
          circ(sh.x, sh.y, sh.r);
          fill(pal.text, 0.75 * L);
          g.fill();
        }
        nameIt('tamb', 'Tamb', sh.x, sh.y, { font: F(10), color: L > 0.45 ? pal.bg : pal.text3 });
      } else if (sh.type === 'cowbell') {
        ink(pal.line2);
        line(sh.x, sh.y - 0.02, sh.x, S.kick.rect[3]);
        g.stroke();
        poly([
          [sh.x - 0.038, sh.y - 0.075],
          [sh.x + 0.038, sh.y - 0.075],
          [sh.x + 0.024, sh.y + 0.075],
          [sh.x - 0.024, sh.y + 0.075],
        ]);
        fill('#34302b', 1);
        g.fill();
        ink(pal.text2, 0.8);
        g.stroke();
        if (L > 0) {
          fill(pal.text, 0.8 * L);
          g.fill();
        }
        nameIt('cowbell', 'Cowbell', sh.x, sh.y + 0.115, { font: F(10), color: pal.text3, plate: true });
      } else if (sh.type === 'shaker') {
        const [X, Y] = toS(t, sh.x, sh.y),
          lw = 0.06 * s,
          r = 0.018 * s;
        g.beginPath();
        g.moveTo(X - lw + r, Y - r);
        g.lineTo(X + lw - r, Y - r);
        g.arc(X + lw - r, Y, r, -Math.PI / 2, Math.PI / 2);
        g.lineTo(X - lw + r, Y + r);
        g.arc(X - lw + r, Y, r, Math.PI / 2, Math.PI * 1.5);
        g.closePath();
        fill('#3a3631', 1);
        g.fill();
        ink(pal.text2, 0.8);
        g.stroke();
        if (L > 0) {
          fill(pal.text, 0.8 * L);
          g.fill();
        }
        nameIt('shaker', small ? 'Shaker' : `Shaker, ${sh.realY} m`, sh.x, sh.y + 0.045, {
          font: F(10, 400),
          color: pal.text3,
        });
      } else if (sh.type === 'clap') {
        const [X, Y] = toS(t, sh.x, sh.y),
          r = 0.03 * s;
        ink(L > 0 ? pal.text : pal.text2, L > 0 ? 0.5 + 0.5 * L : 0.85);
        g.lineWidth = L > 0 ? 2 : 1;
        g.beginPath();
        g.arc(X - r * 0.35, Y, r, Math.PI * 0.6, Math.PI * 1.4);
        g.stroke();
        g.beginPath();
        g.arc(X + r * 0.35, Y, r, -Math.PI * 0.4, Math.PI * 0.4);
        g.stroke();
        g.lineWidth = 1;
        // (a little right of the claps: the crush mic's name is just left of them)
        nameIt('clap', small ? 'Claps' : `Claps, ${sh.realY} m`, sh.x + (small ? 0 : 0.035), sh.y + 0.045, {
          font: F(10, 400),
          color: pal.text3,
        });
      }
      // a piece turned all the way down is off: dashed, like a muted clip
      if (off) {
        outline(sh, 4);
        ink(pal.text3, 0.9);
        g.setLineDash([3, 3]);
        g.stroke();
        g.setLineDash([]);
      }
      // the light's ring: who played it
      if (L > 0) {
        const c = ringInk(sh.piece);
        if (c) {
          outline(sh, 3);
          ink(c, Math.min(1, L * 1.3));
          g.lineWidth = 1.5;
          g.stroke();
          g.lineWidth = 1;
        }
      }
    }
    function outline(sh, pad) {
      if (sh.type === 'kick') {
        // the shell and its foot (where its pedal and its name are)
        const q = sh.rect,
          d = pad / s,
          ft = sh.foot;
        poly([
          [q[0] - d, q[1] - d],
          [ft[0] - d, q[1] - d],
          [ft[0] - d, ft[1] - d],
          [ft[2] + d, ft[1] - d],
          [ft[2] + d, q[1] - d],
          [q[2] + d, q[1] - d],
          [q[2] + d, q[3] + d],
          [q[0] - d, q[3] + d],
        ]);
        return;
      }
      const [X, Y] = toS(t, sh.x, sh.y);
      g.beginPath();
      g.arc(X, Y, sh.r * s + pad, 0, Math.PI * 2);
    }

    // the mics: the overheads over the kit, the close mics on what they mic (shown while their fader is in use), the
    // crush mic and the room pair past the break. Solid while the fader is up, dashed while it's off.
    const on = {
      oh: +P.mix_oh > -39.9,
      room: +P.mix_room > -39.9,
      crush: +P.mix_crush > -39.9,
      close: +P.mix_close > -39.9,
    };
    const hi = (bus) => micHi === bus || (micHi === 'bleed' && bus === 'close') || (micHi === 'size' && bus === 'room');
    const mic = (x, y, label, bus, { dir = null, labelBelow = false, sub = '', side = 0 } = {}) => {
      const [X, Y] = toS(t, x, y),
        r = Math.max(3.5, 0.02 * s);
      if (dir == null) {
        const [kx, ky] = toS(t, 0.1, 0.35);
        dir = Math.atan2(ky - Y, kx - X);
      } // (aimed at the kit)
      const lit = hi(bus);
      ink(lit ? pal.text : pal.text2, lit ? 1 : 0.85);
      g.lineWidth = lit ? 1.5 : 1;
      if (!on[bus]) g.setLineDash([2, 2]);
      g.beginPath();
      g.arc(X, Y, r, 0, Math.PI * 2);
      if (on[bus]) {
        fill(lit ? pal.text : pal.text3, lit ? 0.9 : 0.55);
        g.fill();
      }
      g.stroke();
      const sx = X + Math.cos(dir) * r,
        sy = Y + Math.sin(dir) * r;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx + Math.cos(dir) * r * 2.2, sy + Math.sin(dir) * r * 2.2);
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 1;
      if (flashes.has(bus)) cropMarks(X - r - 6, Y - r - 6, 2 * r + 12, 2 * r + 12, now, flashes.get(bus));
      if (label && side) {
        // beside it, outward, knocked out of the ground (it sits over the kit)
        const sd = side * (Math.cos(theta) < 0 ? -1 : 1);
        g.font = F(10, 400, pal.mono);
        g.textAlign = sd < 0 ? 'right' : 'left';
        g.textBaseline = 'middle';
        const lx = X + sd * (r + 5);
        g.globalAlpha = 0.92;
        g.strokeStyle = pal.bg;
        g.lineWidth = 4;
        g.lineJoin = 'round';
        g.strokeText(label, lx, Y);
        g.lineWidth = 1;
        fill(lit ? pal.text : pal.text2);
        g.fillText(label, lx, Y);
      } else if (label) {
        const below = labelBelow !== Math.cos(theta) < 0;
        g.font = F(10, 400, pal.mono);
        g.textAlign = 'center';
        g.textBaseline = below ? 'top' : 'bottom';
        fill(lit ? pal.text : pal.text3);
        const half = g.measureText(label).width / 2 + 3;
        // (inside the page: on a phone the names are 12 px and the band is short)
        const tall = parseFloat(g.font.match(/([\d.]+)px/)[1]) + 2;
        g.fillText(label, clamp(X, half, w - half), below ? Math.min(Y + r + 3, hh - tall) : Math.max(Y - r - 3, tall));
        if (sub) {
          g.textBaseline = 'top';
          g.fillText(sub, X, Y + r + 3);
        }
      }
    };
    LAYOUT.overheads.forEach(([x, y], i) => mic(x, y, small ? '' : i ? 'OH R' : 'OH L', 'oh', { side: i ? 1 : -1 }));
    if (hi('close'))
      for (const piece of ['kick', 'snare', 'hat', 'tom1', 'tom2', 'tom3', 'tom4', 'ride', 'tamb', 'cowbell']) {
        const sh = S[piece];
        if (sh.type === 'kick') mic(sh.x + 0.08, sh.rect[1] + 0.05, '', 'close');
        else mic(sh.x - sh.r * 0.55, sh.y - sh.r - 0.03, '', 'close', { dir: Math.PI * 0.75 });
      }
    {
      const by = BAND_Y.room;
      const rx = (x) => clamp(x, FRAME.x0 + 0.16, FRAME.x1 - 0.16);
      const [rl, rr] = LAYOUT.room;
      mic(rx(rl[0]), by, small ? 'Room L' : `Room L, ${rl[1]} m`, 'room');
      mic(rx(rr[0]), by, small ? 'Room R' : `Room R, ${rr[1]} m`, 'room');
      mic(LAYOUT.crush[0], BAND_Y.crush, small ? 'Crush' : `Crush, ${LAYOUT.crush[1]} m`, 'crush');
    }

    // the selected piece: a cream frame; under the pointer: a hairline and the ring it would hit; an agent's change
    if (selected && S[selected]) {
      outline(S[selected], 6);
      ink(pal.text, 1);
      g.lineWidth = 1.5;
      g.stroke();
      g.lineWidth = 1;
    }
    if (hover && S[hover.piece]) {
      const sh = S[hover.piece];
      outline(sh, 3);
      ink(pal.text, 0.55);
      g.stroke();
      const rz = {
        center: [0, 0.6],
        edge: sh.piece === 'snare' ? [0.6, 0.86] : sh.piece === 'hat' ? [0.72, 1] : [0.84, 1],
        rim: [0.86, 1],
        tip: [0, 0.72],
        bell: [0, 0.24],
        bow: [0.24, 0.84],
      }[hover.zone];
      if (rz && sh.type !== 'kick') {
        const [X, Y] = toS(t, sh.x, sh.y);
        g.beginPath();
        g.arc(X, Y, rz[1] * sh.r * s, 0, Math.PI * 2);
        if (rz[0]) g.arc(X, Y, rz[0] * sh.r * s, 0, Math.PI * 2, true);
        fill(pal.text, 0.12);
        g.fill('evenodd');
        ink(pal.text, 0.45);
        g.setLineDash([3, 3]);
        g.beginPath();
        g.arc(X, Y, rz[1] * sh.r * s, 0, Math.PI * 2);
        g.stroke();
        if (rz[0]) {
          g.beginPath();
          g.arc(X, Y, rz[0] * sh.r * s, 0, Math.PI * 2);
          g.stroke();
        }
        g.setLineDash([]);
      }
    }
    for (const [k, until] of flashes) {
      if (k === 'stage') {
        cropMarks(3, 3, w - 6, hh - 6, now, until);
        continue;
      }
      const sh = S[k];
      if (!sh) continue;
      if (sh.type === 'kick') {
        const a = toS(t, sh.rect[0], sh.pedal[1]),
          b = toS(t, sh.rect[2], sh.rect[3]);
        cropMarks(
          Math.min(a[0], b[0]) - 6,
          Math.min(a[1], b[1]) - 6,
          Math.abs(b[0] - a[0]) + 12,
          Math.abs(b[1] - a[1]) + 12,
          now,
          until,
        );
      } else {
        const [X, Y] = toS(t, sh.x, sh.y),
          r = sh.r * s + 7;
        cropMarks(X - r, Y - r, 2 * r, 2 * r, now, until);
      }
    }
    function cropMarks(x, y, cw, ch, nowT, until) {
      const a = clamp((until - nowT) / 600, 0, 1);
      if (a <= 0) return;
      const k = Math.min(10, cw / 3, ch / 3);
      g.save();
      g.globalAlpha = a;
      g.strokeStyle = pal.agent;
      g.lineWidth = 2;
      g.lineCap = 'square';
      g.beginPath();
      g.moveTo(x, y + k);
      g.lineTo(x, y);
      g.lineTo(x + k, y);
      g.moveTo(x + cw - k, y);
      g.lineTo(x + cw, y);
      g.lineTo(x + cw, y + k);
      g.moveTo(x, y + ch - k);
      g.lineTo(x, y + ch);
      g.lineTo(x + k, y + ch);
      g.moveTo(x + cw - k, y + ch);
      g.lineTo(x + cw, y + ch);
      g.lineTo(x + cw, y + ch - k);
      g.stroke();
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // the fonts arrive after the first drawing
  try {
    document.fonts?.ready?.then(() => {
      pal = colors();
      cv.dirty();
    });
  } catch {
    /* no font loading API */
  }

  /* ================================================================ for the checks */
  const api = {
    get selected() {
      return selected;
    },
    select: (piece) => select(piece || null, { focus: false }),
    // a point (client px) on a piece: its middle, or a zone's ('center' 'edge' 'rim' 'tip' 'bell' 'bow' 'pedal' 'shell'),
    // `at` 0..1 from the top of that ring to its bottom (the velocity); touch: one a finger lands on it too (a finger
    // reaches further: the china's reach takes in the ride's middle)
    point(piece, { zone = null, at = 0.5, touch = false } = {}) {
      const sh = S[piece];
      if (!sh) return null;
      const r = stage.getBoundingClientRect(),
        t = T(r.width, r.height);
      const out = (X, Y) => ({ x: r.left + X, y: r.top + Y });
      // (a point a pixel off would hit the same: browsers round a pointer's position differently)
      const same = (X, Y) => {
        const hit = hitAt(X, Y, { touch });
        return !!hit && hit.piece === piece && (!zone || hit.zone === zone);
      };
      const ok = (X, Y) => same(X, Y) && same(X - 2, Y) && same(X + 2, Y) && same(X, Y - 2) && same(X, Y + 2);
      if (sh.type === 'kick' || zone === 'pedal') {
        const q = zone === 'shell' ? [sh.rect[0], sh.rect[1], sh.rect[2], sh.rect[1] + 0.06] : sh.pedal;
        const a = toS(t, q[0], q[1]),
          b = toS(t, q[2], q[3]);
        const top = Math.min(a[1], b[1]),
          bot = Math.max(a[1], b[1]);
        return out((a[0] + b[0]) / 2, top + 1 + (bot - top - 2) * at);
      }
      const R = {
        center: [0, 0.6],
        edge: piece === 'snare' ? [0.6, 0.86] : piece === 'hat' ? [0.72, 1] : [0.84, 1],
        rim: [0.86, 1],
        tip: [0, 0.72],
        bell: [0, 0.24],
        bow: [0.24, 0.84],
      }[zone] || [0, 1];
      const [cx, cy] = toS(t, sh.x, sh.y),
        rad = sh.r * t.s;
      const rz = R[1] * rad,
        dy = (at - 0.5) * 2 * rz * 0.9;
      const tries = [];
      if (R[0] === 0) {
        tries.push([cx, cy + dy]);
        for (const f of [0.35, -0.35, 0.6, -0.6])
          tries.push([cx + f * Math.sqrt(Math.max(0, rz * rz - dy * dy)), cy + dy]);
      }
      // a ring: across from the middle at the asked height, then all round it
      const mid = ((R[0] + R[1]) / 2) * rad;
      if (R[0] > 0) {
        const xo = Math.sqrt(Math.max(0, mid * mid - dy * dy));
        if (xo > 0) tries.push([cx - xo, cy + dy], [cx + xo, cy + dy]);
      }
      for (let k = 0; k < 24; k++) {
        const a = (k * Math.PI) / 12;
        tries.push([cx + Math.cos(a) * (R[0] > 0 ? mid : rz * 0.5), cy + Math.sin(a) * (R[0] > 0 ? mid : rz * 0.5)]);
      }
      for (const [X, Y] of tries) if (ok(X, Y)) return out(X, Y);
      return out(cx, cy + dy);
    },
    hit(x, y, o = {}) {
      const r = stage.getBoundingClientRect();
      return hitAt(x - r.left, y - r.top, o);
    },
    // a piece's name as drawn: its middle and size, client px
    name(piece) {
      const n = named.get(piece);
      if (!n) return null;
      const r = stage.getBoundingClientRect();
      return { x: r.left + n.x, y: r.top + n.y, w: n.w, h: n.h };
    },
    lit: (piece) => level(piece),
    flashing: (k) => flashes.has(k),
    hat: () => Math.max(hatOpen, hatHeld),
    get view() {
      return thetaTo ? 'audience' : 'drummer';
    },
    get look() {
      return { kit: KITS[kitI], ...look };
    },
  };
  app.drumroom = api;

  return {
    update() {},
    frame,
    unmount() {
      offOn?.();
      offNote?.();
      for (const [, pr] of pointers) release(pr.note);
      for (const [piece] of keyNotes) stopKeyNote(piece);
      pointers.clear();
      meter.destroy();
      cv.destroy();
      if (app.drumroom === api) delete app.drumroom;
      root.remove();
    },
  };
}

const CSS = `
/* Studio A's window (ui/editors/drumroom.js): the drawn kit, the selected piece, the mic mix */
.dr { width: 900px; max-width: 100%; box-sizing: border-box; padding: 10px 16px 12px; container: dr / inline-size; }
/* (it fits a 1280 by 800 screen whole: the kit, the selected piece beside it, the mic mix under them) */
.dr-main { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 0 20px; align-items: start; }
.dr-left { min-width: 0; }
.dr-stage { position: relative; width: 100%; aspect-ratio: var(--dr-ar, 1.51); touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.dr-stage .dr-cv { position: absolute; inset: 0; width: 100%; height: 100%; }
/* each piece is a button for the keyboard (the drawing takes the pointer): its frame shows only on focus */
.dr-pc { position: absolute; z-index: 1; transform: translate(-50%, -50%); margin: 0; padding: 0; border: 0; border-radius: var(--r-press); background: none; pointer-events: none; }
.dr-pc:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.dr-cap { margin: 4px 0 0; min-height: 4.35em; font-size: 12.5px; line-height: 1.45; color: var(--text-2); }
.dr-cap b { font-weight: 600; color: var(--text); }
.dr-side { min-width: 0; display: grid; gap: 12px; align-content: start; }
.dr-kit { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 6px 10px; }
.dr-lbl { font: 600 12px/1.2 var(--font-ui); color: var(--text-2); }
.dr-kit .pk-seg { justify-self: start; }
.dr-cym { margin-top: 14px; }
.dr-kitline { grid-column: 1 / -1; margin: 0; min-height: 2.9em; font-size: 12.5px; line-height: 1.45; color: var(--text-2); }
.dr-kitline.dr-preview { color: var(--text-3); }
.dr-sel { min-width: 0; }
.dr-sel[hidden] { display: none; }
.dr-sel-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; padding-top: 10px; border-top: var(--rule); }
.dr-sel-h h3 { margin: 0; font: 600 13.5px/1.25 var(--font-ui); color: var(--text); }
.dr-sel-m { flex: 1 1 100%; order: 3; min-width: 0; font-size: 12px; line-height: 1.4; color: var(--text-3); }
.dr-whole { margin-left: auto; font-size: 12px; }
.dr-knobs { display: flex; flex-wrap: wrap; gap: 14px 10px; margin-top: 10px; }
.dr-arts { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; margin-top: 10px; border-top: var(--rule); }
.dr-art { display: grid; grid-template-columns: 2.1em 1fr; align-items: baseline; column-gap: 6px; min-height: 30px; margin: 0; padding: 5px 4px; border: 0; border-bottom: var(--rule); border-radius: 0; background: none; color: var(--text); font: 600 12px/1.3 var(--font-ui); text-align: left; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }
.dr-art:hover { background: var(--bg-3); }
.dr-art:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
.dr-art.on, .dr-art.on:hover { background: var(--text); color: var(--bg); }
.dr-art.on .dr-art-n, .dr-art.on .dr-art-h { color: var(--bg); }
.dr-art-n { font: 400 11.5px/1.3 var(--font-mono); color: var(--text-3); }
.dr-art-h { grid-column: 2; font-weight: 400; font-size: 11px; color: var(--text-3); }
.dr-art-h[data-touch] { display: none; }
/* no Alt key under a finger: a choke is a cymbal held down (or the key itself) */
@media (pointer: coarse) { .dr-art-h[data-alt] { display: none; } .dr-art-h[data-touch] { display: block; } }
.dr-mix { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 0 14px; align-items: start; margin-top: 10px; padding-top: 8px; border-top: var(--rule); }
/* its name in the first column, as a console labels its strips */
.dr-mix-h { display: grid; gap: 4px; align-content: start; }
.dr-mix-t { font: 600 13.5px/1.2 var(--font-ui); color: var(--text); }
.dr-mix-s { font-size: 12px; line-height: 1.35; color: var(--text-3); }
.dr-strips { display: flex; align-items: stretch; overflow-x: auto; overscroll-behavior-x: contain; padding-bottom: 2px; }
.dr-strip { flex: none; display: grid; justify-items: center; align-content: start; gap: 4px; min-width: 62px; padding: 0 8px; border-left: var(--rule); }
.dr-strip:first-child { padding-left: 0; border-left: 0; }
.dr-strip-sub { max-width: 84px; font-size: 11px; line-height: 1.3; color: var(--text-3); text-align: center; }
.dr-view { min-width: 0; }
.dr-view .dr-strip-sub { max-width: 170px; }
.dr-out .pk-meter-v { height: 80px; margin-top: 4px; }
/* narrow (a window sized small, a phone): the kit picker, then the kit, then the selected piece under it */
@container dr (max-width: 759px) {
  .dr-main { grid-template-columns: minmax(0, 1fr); }
  .dr-side { display: contents; }
  .dr-kit { order: -1; margin-bottom: 12px; }
  .dr-sel { margin-top: 12px; }
  .dr-mix { grid-template-columns: minmax(0, 1fr); }
  .dr-mix-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 10px; }
}
.pw-phone .dr { width: auto; padding: 12px 16px 16px; }
.pw-phone .dr-lbl, .pw-phone .dr-sel-m, .pw-phone .dr-strip-sub, .pw-phone .dr-mix-s, .pw-phone .dr-art-n, .pw-phone .dr-art-h { font-size: 12px; }
.pw-phone .dr-cap, .pw-phone .dr-kitline { font-size: 12.5px; }
.pw-phone .dr-art { min-height: 44px; font-size: 13px; }
.pw-phone .dr-whole { min-height: 44px; }
.pw-phone .dr-pc { min-width: 44px; min-height: 44px; }
.pw-phone .dr-strip { min-width: 76px; }
.pw-phone .dr-strip .pk-slider-v .pk-sl { width: 44px; }
.pw-phone .dr-strip .pk-slider-v .pk-sl-trk, .pw-phone .dr-strip .pk-slider-v .pk-sl-fill { left: 21px; }
.pw-phone .dr-strip .pk-slider-v .pk-sl-cap { left: 10px; width: 24px; height: 12px; }
`;
