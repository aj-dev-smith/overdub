// vendored verbatim from clawd-o-matic/web/presets.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ================================================================ Claw'd-o-Matic: presets (plug in) */
// Concatenated in the app's scope after ampui.js and before plugin.js. Whole sounds (an amp, its knobs and the pedals)
// to start from, the ones you save yourself, and the patch browser that picks them.
// A preset: { id, name, blurb (≤60), tags, amp, knobs: { gain, bass, mid, treble, presence, level }, and fx or board }
// and maybe cab, mic, mic2 (amps.js) (and hot: a badge for one to try first).
//   board: [{ id, ...knobs }, 'amp', ...]: exactly these pedals in this order (each on unless it says on: false, knobs it
//     doesn't give at their defaults), the amp where 'amp' is (or placed by the pedals' where). Any registered pedal.
//   fx: { gate: {...}, drive: {...}, ... }: the classic board (gate, drive, fuzz, amp, chorus, delay, reverb) with the ones
//     it lists on (unless on: false) and the rest off at their defaults. (The first presets, and older saves of yours.)
// Levels are measured with tools/plug-level.js (the DI strum through each preset): −14 LUFS ±1, leads up to −12.5 so
// they cut, true peak ≤ −1 dBFS; the amp's LEVEL (MASTER) is what evens them out. Clean presets keep the gate low
// enough not to cut a ringing note short (the tool checks).
const PLUG_PRESETS = [
  { id: 'pinch', name: 'Three Chords', blurb: 'The go-to: tight, loud pop-punk power chords', tags: ['rhythm'], amp: 'punk',
    knobs: { gain: 6, bass: 5, mid: 5, treble: 6, presence: 5, level: 6 }, fx: { gate: { th: -62 } } },
  { id: 'webcam', name: 'Webcam Shred', blurb: '2006 bedroom solo: boosted, dotted 8ths, big room', tags: ['lead'], hot: 'Solo over the band', amp: 'lead',
    knobs: { gain: 7, bass: 4.5, mid: 6, treble: 6, presence: 6, level: 5.2 },
    fx: { gate: { th: -66 }, drive: { drive: 2, tone: 6.5, level: 7 }, delay: { time: 2, fb: 4, mix: 4.5 }, verb: { decay: 5.5, tone: 5, mix: 3.5 } } },
  { id: 'pin77', name: "Safety Pin '77", blurb: 'Cranked British stack: raw, loud, mid-forward', tags: ['rhythm'], amp: 'plexi',
    knobs: { gain: 7, bass: 5, mid: 6.5, treble: 6, presence: 5.5, level: 5.7 }, fx: { gate: { th: -62 } } },
  { id: 'skate', name: 'Skate Rat', blurb: 'Bright, fast downpicking for kickflip punk', tags: ['rhythm'], amp: 'punk',
    knobs: { gain: 7.5, bass: 5.5, mid: 4, treble: 6.5, presence: 6, level: 5.6 }, fx: { gate: { th: -58 }, drive: { drive: 1, tone: 6, level: 6 } } },
  { id: 'pit', name: 'Pit Warning', blurb: 'Hardcore breakdown chug: boosted, gated, heavy', tags: ['rhythm', 'heavy'], amp: 'plexi',
    knobs: { gain: 9, bass: 6.5, mid: 5, treble: 6, presence: 6, level: 5.1 }, fx: { gate: { th: -52 }, drive: { drive: 0, tone: 7, level: 8 } } },
  { id: 'kraken', name: 'Kraken Core', blurb: 'Scooped, huge metalcore with a tight low end', tags: ['rhythm', 'heavy'], amp: 'recto',
    knobs: { gain: 7.5, bass: 5.5, mid: 4, treble: 6.5, presence: 6.5, level: 6 }, fx: { gate: { th: -50 }, drive: { drive: 0, tone: 6.5, level: 7 } } },
  { id: 'emo', name: 'Basement Emo', blurb: 'Clean arpeggios with a watery shimmer', tags: ['clean'], amp: 'clean',
    knobs: { gain: 4, bass: 4.5, mid: 5.5, treble: 6, presence: 5.5, level: 7 },
    fx: { gate: { th: -80 }, chorus: { rate: 3, depth: 5, mix: 4 }, verb: { decay: 3, tone: 5, mix: 2.5 } } },
  { id: 'twinkle', name: 'Twinkle Tap', blurb: 'Midwest sparkle for tapped, noodly lines', tags: ['clean'], amp: 'jangle',
    knobs: { gain: 3, bass: 4.5, mid: 5, treble: 6.5, presence: 6, level: 7 },
    fx: { gate: { th: -80 }, delay: { time: 1, fb: 2, mix: 2.5 }, verb: { decay: 4, tone: 6, mix: 3 } } },
  { id: 'surf', name: 'Wipeout Reef', blurb: 'Drippy spring-ish reverb and slapback', tags: ['clean'], amp: 'clean',
    knobs: { gain: 5, bass: 4, mid: 5, treble: 7, presence: 6, level: 5.2 },
    fx: { gate: { th: -80 }, delay: { time: 0, fb: 0, mix: 4 }, verb: { decay: 4.5, tone: 7.5, mix: 5 } } },
  { id: 'jangle', name: 'Coral Jangle', blurb: 'Chimey indie strum with a little hair on it', tags: ['rhythm', 'clean'], amp: 'jangle',
    knobs: { gain: 5, bass: 5, mid: 5, treble: 6, presence: 5.5, level: 6.4 }, fx: { gate: { th: -72 }, verb: { decay: 3, tone: 5, mix: 2 } } },
  { id: 'ska', name: 'Upstroke Club', blurb: 'Choppy, bright offbeats that bounce', tags: ['rhythm', 'clean'], amp: 'clean',
    knobs: { gain: 3, bass: 3.5, mid: 6, treble: 7, presence: 6.5, level: 6.7 }, fx: { gate: { th: -80 }, verb: { decay: 2, tone: 6, mix: 1.5 } } },
  { id: 'crunch', name: 'Shack Crunch', blurb: 'Classic rock crunch; dig in and it growls', tags: ['rhythm'], amp: 'crunch',
    knobs: { gain: 6, bass: 5, mid: 6, treble: 6, presence: 5.5, level: 5.8 }, fx: { gate: { th: -66 }, verb: { decay: 3, tone: 5, mix: 1.5 } } },
  { id: 'blues', name: 'Low Tide Blues', blurb: 'Edge of breakup, a nudge of drive, a little room', tags: ['lead', 'rhythm'], amp: 'crunch',
    knobs: { gain: 4, bass: 5, mid: 6, treble: 5.5, presence: 5, level: 6.6 },
    fx: { gate: { th: -80 }, drive: { drive: 3, tone: 5, level: 6 }, verb: { decay: 3.5, tone: 5, mix: 2.5 } } },
  { id: 'siren', name: 'Siren Sustain', blurb: 'Singing legato lead that holds forever', tags: ['lead'], amp: 'lead',
    knobs: { gain: 8, bass: 5, mid: 6.5, treble: 5.5, presence: 5.5, level: 5.7 },
    fx: { gate: { th: -70 }, delay: { time: 3, fb: 3, mix: 3 }, verb: { decay: 4, tone: 5, mix: 2.5 } } },
  { id: 'boost', name: 'Solo Stomp', blurb: 'The go-to, boosted: stomp it for the solo', tags: ['lead'], amp: 'punk',
    knobs: { gain: 7, bass: 5, mid: 6, treble: 6, presence: 5.5, level: 4.9 },
    fx: { gate: { th: -60 }, drive: { drive: 5, tone: 6.5, level: 8 }, delay: { time: 1, fb: 2.5, mix: 2.5 } } },
  { id: 'stoner', name: 'Sea Sludge', blurb: 'Thick, doomy fuzz. Tune low, play slow', tags: ['heavy', 'rhythm'], amp: 'plexi',
    knobs: { gain: 4, bass: 7, mid: 5.5, treble: 4.5, presence: 4.5, level: 7.4 },
    fx: { gate: { th: -76 }, fuzz: { sustain: 8, tone: 3, level: 5 }, verb: { decay: 4, tone: 4, mix: 2 } } },
  { id: 'gaze', name: 'Wall of Kelp', blurb: 'Fuzz, chorus and a reverb the size of the sea', tags: ['ambient', 'heavy'], amp: 'jangle',
    knobs: { gain: 4, bass: 5, mid: 5, treble: 5, presence: 5, level: 5.8 },
    fx: { gate: { th: -72 }, fuzz: { sustain: 6, tone: 6, level: 5 }, chorus: { rate: 2, depth: 7, mix: 5 }, delay: { time: 3, fb: 5, mix: 3 }, verb: { decay: 9, tone: 4, mix: 7 } } },
  { id: 'lofi', name: 'Hermit Tapes', blurb: 'Trashy little practice amp, warbly as a tape', tags: ['rhythm'], amp: 'tiny',
    knobs: { gain: 5, bass: 5, mid: 5, treble: 5, presence: 4.5, level: 6.8 },
    fx: { gate: { th: -66 }, chorus: { rate: 1, depth: 6, mix: 4 }, verb: { decay: 3, tone: 3.5, mix: 2 } } },
  { id: 'swells', name: 'Trench Swells', blurb: 'Roll your volume in: an endless, glassy ocean', tags: ['ambient', 'clean'], amp: 'clean',
    knobs: { gain: 3, bass: 4.5, mid: 5, treble: 5.5, presence: 5, level: 7.2 },
    fx: { gate: { on: false, th: -62 }, chorus: { rate: 1.5, depth: 5, mix: 4 }, delay: { time: 4, fb: 6, mix: 5 }, verb: { decay: 10, tone: 4, mix: 8 } } },
  // with a cab and mics of their own (amps.js: PLUG_CABS, PLUG_MICS)
  { id: 'studio', name: 'Studio Pair', blurb: 'A dynamic and a ribbon on a 4x12: the record-ready rhythm', tags: ['rhythm'], amp: 'punk',
    knobs: { gain: 6.5, bass: 5, mid: 5.5, treble: 6, presence: 5.5, level: 5.7 }, fx: { gate: { th: -62 } },
    cab: 'g412', mic: { type: 'dyn', x: 0.26, y: -0.12, dist: 1, ang: 0, s: 0 }, mic2: { type: 'ribbon', x: 0.55, y: 0.2, dist: 2, ang: 0, s: 0, blend: 4, flip: false } },
  { id: 'phone', name: 'Long Distance', blurb: 'The intro down a phone line; stomp for the chorus', tags: ['clean'], amp: 'jangle',
    knobs: { gain: 5, bass: 5, mid: 6, treble: 6, presence: 5, level: 6.4 }, fx: { gate: { th: -72 }, verb: { decay: 2, tone: 5, mix: 1.5 } }, cab: 'phone' },
  { id: 'abyss', name: 'Deep Sea Bass', blurb: 'An octave down and fuzzed: a synth bass from your guitar', tags: ['heavy'], amp: 'abyss',
    knobs: { gain: 6, bass: 5, mid: 5, treble: 6, presence: 5, level: 6 }, fx: { gate: { th: -60 } } },
];
// Banks, VST style: presets/*.js (loaded after this file, in file-name order) each call presetBank(bank, presets) to file
// a themed set: bank = { id, name, blurb (≤60), color }. The presets above are the first bank. A preset's id must be
// unique across every bank (a save or a share names it): a clash is refused with an error.
const PRESET_BANKS = [{ id: 'classics', name: 'Clawd Classics', blurb: 'Where it started: the first sounds', color: '#ffb347' }];
for (const p of PLUG_PRESETS) p.bank = 'classics';
function presetBank(b, list) {
  if (!b || !/^[a-z][a-z0-9-]{1,23}$/.test(b.id || '') || PRESET_BANKS.some((x) => x.id === b.id)) { console.error('presetBank: a bad or taken bank id', b && b.id); return; }
  PRESET_BANKS.push(Object.assign({ name: b.id, blurb: '', color: '#ffb347' }, b));
  for (const p of list || []) {
    if (!p || !p.id || PLUG_PRESETS.some((x) => x.id === p.id)) { console.error('presetBank: a bad or taken preset id', b.id, p && p.id); continue; }
    PLUG_PRESETS.push(Object.assign({ tags: [] }, p, { bank: b.id }));
  }
}
// The factory presets by bank, in PRESET_BANKS order (an empty bank left out), numbered from 1: the Plug in tab's rail
// and the studio's browser both file them this way, so a patch (its bank's number and a letter: 4C) reads the same in both.
function presetBanks() {
  const out = [];
  for (const b of PRESET_BANKS) { const list = PLUG_PRESETS.filter((p) => p.bank === b.id); if (list.length) out.push(Object.assign({}, b, { list, n: out.length + 1 })); }
  return out;
}
const presetLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : '·' + (i + 1));
const PRESET_KNOBS = ['gain', 'bass', 'mid', 'treble', 'presence', 'level'];
const PRESET_KEY = 'clawd-o-matic:plug-presets';

// A preset's whole sound as the settings P holds: { amp, gain, ..., level, board } (every pedal, every knob).
function presetResolve(p) {
  const out = { amp: PLUG_AMPS[p && p.amp] ? p.amp : 'punk', board: p && Array.isArray(p.board) ? boardClean(p.board) : boardFromFx(p && p.fx, true) };
  const k = (p && p.knobs) || {};
  for (const n of PRESET_KNOBS) out[n] = Number.isFinite(+k[n]) ? Math.max(0, Math.min(10, +k[n])) : PLUG_DEFAULT[n] != null ? PLUG_DEFAULT[n] : 5;
  return Object.assign(out, plugCabClean(p)); // (its cab and mics, if it isn't the amp's own: amps.js)
}
// Are two settings the same sound? (a knob within a hair)
function presetSame(a, b) {
  if (!a || !b || a.amp !== b.amp) return false;
  const near = (x, y) => Math.abs((+x || 0) - (+y || 0)) < 1e-6;
  for (const n of PRESET_KNOBS) if (!near(a[n] != null ? a[n] : 5, b[n] != null ? b[n] : 5)) return false;
  if (JSON.stringify(plugCabClean(a)) !== JSON.stringify(plugCabClean(b))) return false;
  if (!a.board || !b.board || a.board.length !== b.board.length) return false;
  for (let i = 0; i < a.board.length; i++) {
    const x = a.board[i], y = b.board[i];
    if (x.id !== y.id) return false;
    if (x.id === 'amp') continue;
    if (!!x.on !== !!y.on) return false;
    for (const k of pedalKnobs(x.id)) if (!near(x[k.key], y[k.key])) return false;
  }
  return true;
}
// The sound in P as a preset (for saving yours).
function presetFrom(P, id, name) {
  const knobs = {};
  for (const n of PRESET_KNOBS) knobs[n] = P[n];
  const board = P.board.map((e) => (e.id === 'amp' ? 'amp' : Object.assign({}, e)));
  return Object.assign({ id, name, blurb: '', tags: ['mine'], amp: P.amp, knobs, board }, plugCabClean(P));
}
// Your saved presets from storage: anything malformed is dropped, the rest is clamped to what the knobs can do.
function presetsClean(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch (e) { list = null; } }
  if (!Array.isArray(list)) return [];
  const out = [], seen = new Set();
  for (const s of list.slice(0, 99)) {
    if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.name.trim()) continue;
    let id = typeof s.id === 'string' && /^u[\w-]{1,40}$/.test(s.id) ? s.id : 'u' + out.length + '-' + Math.random().toString(36).slice(2, 8);
    if (seen.has(id)) id += '-' + out.length;
    seen.add(id);
    const r = presetResolve(s);
    out.push(presetFrom(r, id, s.name.trim().slice(0, 24)));
  }
  return out;
}

/* ---- the patch browser: an LCD with the preset's name (and * once you turn a knob), prev/next, save, rename and
   delete for yours; a rail of banks (and Your Sounds) with one bank's tiles at a time, each tile the pedals it lights.
   Prev/next and the arrow keys walk every preset in order, across the banks, like a floor unit's.
   opts: { P (settings; read only here), active (a preset id from the last visit), apply(settings) (the owner sets P,
   the amp, the board and the rig), onActive() (the active preset changed: save it) } */
function plugPresetUI({ P, active, apply, onActive }) {
  let mine = presetsClean(store.get(PRESET_KEY));
  const all = () => PLUG_PRESETS.concat(mine);
  const byId = (id) => all().find((p) => p.id === id) || null;
  const persist = () => store.set(PRESET_KEY, JSON.stringify(mine.map((p) => Object.assign({ id: p.id, name: p.name, amp: p.amp, knobs: p.knobs, board: p.board }, plugCabClean(p)))));
  let cur = byId(active) ? active : null, mode = null, delArmed = 0;
  if (!cur) { const m = all().find((p) => presetSame(P, presetResolve(p))); cur = m ? m.id : null; }
  const BK = presetBanks();
  const bankOf = (id) => { const p = byId(id); return !p ? null : mine.includes(p) ? 'mine' : p.bank; };
  let bank = bankOf(cur) || (BK[0] ? BK[0].id : 'mine'); // (the bank on show: the one you're playing from)
  const root = document.createElement('div');
  root.className = 'pz';
  root.innerHTML = `
    <div class="pz-unit">
      <div class="pz-lcd">
        <div class="pz-show"><span class="pz-num"></span><b class="pz-name"></b><i class="pz-ed" title="Edited: a knob or pedal has changed since you picked it">EDITED</i><small class="pz-info"></small></div>
        <form class="pz-form" hidden><label class="pz-lab"></label><input class="pz-in" maxlength="24" autocomplete="off" spellcheck="false" placeholder="Name this sound" aria-label="Preset name"><button type="submit" class="pz-b pz-ok">Store</button><button type="button" class="pz-b pz-no">Cancel</button></form>
      </div>
      <div class="pz-ctl">
        <button type="button" class="pz-b pz-sq" data-d="-1" aria-label="Previous preset"><i class="pz-arr"></i></button>
        <button type="button" class="pz-b pz-sq" data-d="1" aria-label="Next preset"><i class="pz-arr r"></i></button>
        <button type="button" class="pz-b pz-save">Save</button>
        <button type="button" class="pz-b pz-ren" hidden>Rename</button>
        <button type="button" class="pz-b pz-del" hidden>Delete</button>
      </div>
      <p class="pz-say" role="status" aria-live="polite"></p>
    </div>
    <div class="pz-tags" role="group" aria-label="Banks"></div>
    <div class="pz-mid"><p class="pz-about"></p><div class="pz-list" role="radiogroup" aria-label="Presets"></div>
    <p class="pz-none" hidden>Nothing saved yet. Dial in a sound you love, then hit Save.</p></div>`;
  const $ = (s) => root.querySelector(s);
  const list = $('.pz-list'), form = $('.pz-form'), input = $('.pz-in');
  // the rail: a button per bank, its colour, number and size (Your Sounds last: where Save puts yours)
  for (const B of BK.concat({ id: 'mine', name: 'Your Sounds', blurb: 'The sounds you saved.', color: 'var(--s)', n: 'U' })) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pz-tag'; b.dataset.tag = B.id; b.title = B.blurb || '';
    b.style.setProperty('--c', B.color || 'var(--amber)');
    b.innerHTML = `<i aria-hidden="true"></i><span class="pz-tag-n">${B.n === 'U' ? 'U' : String(B.n).padStart(2, '0')}</span><span class="pz-tag-name"></span><small></small>`;
    b.querySelector('.pz-tag-name').textContent = B.name;
    b.addEventListener('click', () => { bank = B.id; draw(); });
    $('.pz-tags').appendChild(b);
  }
  const bankInfo = (id) => BK.find((b) => b.id === id) || null;
  const shown = () => (bank === 'mine' ? mine : (bankInfo(bank) || { list: [] }).list);
  const order = () => BK.flatMap((b) => b.list).concat(mine); // (every preset, as prev/next and the arrows walk them)
  const numOf = (p) => { const i = mine.indexOf(p); if (i >= 0) return 'U' + presetLetter(i); const b = BK.find((x) => x.list.includes(p)); return b ? b.n + presetLetter(b.list.indexOf(p)) : '--'; };
  const pedalsOn = (board) => board.filter((e) => e.on && e.id !== 'amp' && e.id !== 'gate' && PEDAL_DEFS[e.id]).map((e) => PEDAL_DEFS[e.id]);
  const say = (t) => { $('.pz-say').textContent = t; };
  const tiles = {};
  function draw() {
    for (const b of root.querySelectorAll('.pz-tag')) { b.setAttribute('aria-pressed', b.dataset.tag === bank); b.querySelector('small').textContent = b.dataset.tag === 'mine' ? mine.length : (bankInfo(b.dataset.tag) || { list: [] }).list.length; }
    const B = bankInfo(bank);
    $('.pz-about').innerHTML = B ? `<b>BANK ${String(B.n).padStart(2, '0')} · ${ampEsc(B.name)}</b> ${ampEsc(B.blurb || '')}` : '<b>YOUR SOUNDS</b> The ones you saved: dial one in, then Save.';
    list.textContent = '';
    for (const k in tiles) delete tiles[k];
    const L = shown();
    for (const p of L) {
      const S = presetResolve(p), b = document.createElement('button');
      b.type = 'button'; b.className = 'pz-t'; b.setAttribute('role', 'radio'); b.dataset.preset = p.id;
      b.innerHTML = `<span class="pz-t-n"></span><b class="pz-t-name"></b><span class="pz-t-amp"></span><span class="pz-t-fx" aria-hidden="true"></span>`;
      b.querySelector('.pz-t-n').textContent = numOf(p);
      b.querySelector('.pz-t-name').textContent = p.name;
      b.querySelector('.pz-t-amp').textContent = ampInfo(S.amp).name;
      for (const d of pedalsOn(S.board)) { const i = document.createElement('i'); i.style.setProperty('--c', d.color); i.title = d.name; b.querySelector('.pz-t-fx').appendChild(i); }
      if (p.hot) { b.classList.add('hot'); b.insertAdjacentHTML('beforeend', `<span class="pz-hot">★ ${ampEsc(p.hot)}</span>`); }
      b.title = p.blurb || 'Your preset';
      b.setAttribute('aria-label', `${p.name}${p.blurb ? ': ' + p.blurb : ''}. ${ampInfo(S.amp).name}${pedalsOn(S.board).length ? ' with ' + pedalsOn(S.board).map((d) => d.name).join(', ') : ''}`);
      b.addEventListener('click', () => pick(p.id));
      list.appendChild(b); tiles[p.id] = b;
    }
    $('.pz-none').hidden = !(bank === 'mine' && !mine.length);
    sync();
  }
  // the LCD and the lit tile, for what P is now
  function sync() {
    const p = byId(cur), edited = !!p && !presetSame(P, presetResolve(p)), isMine = !!p && mine.includes(p);
    const i = pedalsOn(P.board);
    $('.pz-num').textContent = p ? numOf(p) : '--';
    $('.pz-name').textContent = p ? p.name : 'Your sound';
    root.classList.toggle('edited', edited);
    $('.pz-info').textContent = (edited || !p || !p.blurb ? ampInfo(P.amp).name + (i.length ? ' · ' + i.map((d) => d.name).join(' → ') : ' · no pedals') : p.blurb);
    $('.pz-ren').hidden = $('.pz-del').hidden = !isMine;
    if (!isMine) disarm();
    const L = shown(), tabbable = tiles[cur] ? cur : L.length ? L[0].id : null;
    for (const [id, t] of Object.entries(tiles)) { t.setAttribute('aria-checked', id === cur); t.classList.toggle('edited', id === cur && edited); t.tabIndex = id === tabbable ? 0 : -1; }
  }
  function pick(id, focus) {
    const p = byId(id);
    if (!p) return;
    close();
    cur = id; apply(presetResolve(p)); onActive();
    if (bankOf(id) !== bank) { bank = bankOf(id); draw(); } // (prev/next walked into the next bank: show it)
    sync(); say(`${p.name}${p.blurb ? ': ' + p.blurb : ''}`);
    if (tiles[id] && focus) tiles[id].focus({ preventScroll: true });
    centre(true);
  }
  // keep the lit tile in view along the list when it scrolls sideways (phones), without moving the page
  function centre(smooth) {
    const t = tiles[cur];
    if (!t || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: t.offsetLeft - list.offsetLeft - (list.clientWidth - t.offsetWidth) / 2, behavior: smooth && !REDUCED ? 'smooth' : 'auto' });
  }
  function step(d) {
    const L = order();
    if (!L.length) return;
    const i = L.findIndex((p) => p.id === cur);
    pick(L[i < 0 ? (d > 0 ? 0 : L.length - 1) : (i + d + L.length) % L.length].id);
  }
  list.addEventListener('keydown', (e) => {
    const L = order(), i = L.findIndex((p) => p.id === (document.activeElement && document.activeElement.dataset.preset));
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: L.length - 1 }[e.key];
    if (to == null || !L.length) return;
    e.preventDefault();
    pick(L[(to + L.length) % L.length].id, true);
  });
  for (const b of root.querySelectorAll('.pz-sq')) b.addEventListener('click', () => step(+b.dataset.d));
  // save and rename: the LCD becomes a name field
  function open(m) {
    mode = m; disarm();
    const p = byId(cur);
    $('.pz-lab').textContent = m === 'rename' ? 'RENAME' : 'SAVE AS';
    input.value = m === 'rename' || (p && mine.includes(p)) ? p.name : '';
    $('.pz-show').hidden = true; form.hidden = false; root.classList.add('naming');
    input.focus(); input.select();
  }
  function close(back) {
    if (!mode) return;
    mode = null; form.hidden = true; $('.pz-show').hidden = false; root.classList.remove('naming');
    if (back) $('.pz-save').focus();
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let name = input.value.replace(/\s+/g, ' ').trim().slice(0, 24);
    if (mode === 'rename') {
      const p = byId(cur);
      if (p && mine.includes(p) && name) { p.name = name; persist(); say(`Renamed to “${name}”.`); }
    } else {
      if (!name) { let n = mine.length + 1; while (mine.some((q) => q.name === 'My sound ' + n)) n++; name = 'My sound ' + n; }
      const same = mine.find((q) => q.name.toLowerCase() === name.toLowerCase());
      const p = presetFrom(P, same ? same.id : 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name);
      if (same) mine[mine.indexOf(same)] = p; else mine.push(p);
      persist(); cur = p.id; onActive();
      bank = 'mine';
      say(same ? `Saved over “${name}”.` : `Saved “${name}”. It’s under Your Sounds.`);
    }
    close(true); draw();
  });
  $('.pz-no').addEventListener('click', () => close(true));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } });
  $('.pz-save').addEventListener('click', () => (mode === 'save' ? close(true) : open('save')));
  $('.pz-ren').addEventListener('click', () => (mode === 'rename' ? close(true) : open('rename')));
  // delete: a second press within a few seconds (the button asks first)
  function disarm() { clearTimeout(delArmed); delArmed = 0; const b = $('.pz-del'); b.textContent = 'Delete'; b.classList.remove('armed'); }
  $('.pz-del').addEventListener('click', (e) => {
    const p = byId(cur);
    if (!p || !mine.includes(p)) return;
    if (!delArmed) { close(); e.currentTarget.textContent = 'Sure?'; e.currentTarget.classList.add('armed'); delArmed = setTimeout(disarm, 3000); return; }
    disarm();
    mine = mine.filter((q) => q !== p); persist();
    cur = null; onActive();
    say(`Deleted “${p.name}”. The sound stays on until you pick another.`);
    draw(); $('.pz-save').focus();
  });
  draw();
  return { root, sync, active: () => cur, pick, step, reveal: () => centre(false), bank: (id) => { if (id != null && (id === 'mine' || bankInfo(id))) { bank = id; draw(); } return bank; },
    // for the studio (studio.js): every preset (yours last), the patch number of one, whether it's yours, and the sound now
    all, numOf, mine: (p) => mine.includes(p), saveAs: (name) => { open('save'); input.value = name || ''; form.requestSubmit(); },
    current: () => { const p = byId(cur); return { p, id: cur, num: p ? numOf(p) : '--', name: p ? p.name : 'Your sound', edited: !!p && !presetSame(P, presetResolve(p)), pedals: pedalsOn(P.board) }; } };
}
const PRESET_CSS = `
  .pz { display: grid; gap: 10px; min-width: 0; --amber: #ffb648; }
  /* the unit: an amber LCD and its buttons on a brushed floor box */
  .pz-unit { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px 14px; padding: 12px 14px; border-radius: 6px;
    background: repeating-linear-gradient(90deg, #ffffff05 0 1px, transparent 1px 3px), linear-gradient(#2e2934, #1c1920);
    box-shadow: inset 0 1px 0 #ffffff1c, inset 0 -2px 0 #0006, 0 3px 0 #0008; }
  .pz-lcd { position: relative; min-width: 0; min-height: 60px; display: grid; align-items: center; padding: 8px 12px; border-radius: 4px; color: var(--amber);
    background: repeating-linear-gradient(0deg, transparent 0 2px, #0000002e 2px 3px), radial-gradient(ellipse at 30% 20%, #3a2708, transparent 70%), linear-gradient(#241705, #130c02);
    box-shadow: inset 0 0 0 1px #000, inset 0 2px 8px #000c, 0 0 0 2px #3a3540; }
  .pz-show { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: baseline; gap: 2px 10px; min-width: 0; }
  .pz-show[hidden], .pz-form[hidden] { display: none; }
  .pz-num { font: 400 11px var(--f-px); padding: 1px 4px; border-radius: 2px; background: #ffb64822; color: #ffb648cc; }
  .pz-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 20px/1.15 var(--f-px); text-transform: uppercase; letter-spacing: 0.03em; text-shadow: 0 0 8px #ffa53a88; }
  .pz.edited .pz-name::after { content: '*'; margin-left: 2px; }
  .pz-ed { visibility: hidden; font: 400 7px/1 var(--f-px); font-style: normal; letter-spacing: 0.1em; padding: 3px 4px; border: 1px solid currentColor; border-radius: 2px; opacity: 0.85; }
  .pz.edited .pz-ed { visibility: visible; }
  .pz-info { grid-column: 1 / -1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 12px/1.3 var(--f-mono); color: #ffb648a8; }
  .pz-form { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .pz-lab { font: 400 8px var(--f-px); letter-spacing: 0.1em; opacity: 0.8; white-space: nowrap; }
  .pz-in { flex: 1 1 auto; min-width: 0; min-height: 34px; padding: 0 8px; border: 1px solid #ffb64866; border-radius: 3px; background: #0c0701; color: var(--amber);
    font: 400 16px var(--f-px); text-transform: uppercase; caret-color: var(--amber); }
  .pz-in::placeholder { color: #ffb64855; }
  .pz-in:focus { outline: 2px solid var(--amber); outline-offset: 1px; }
  .pz-ctl { display: flex; flex-wrap: wrap; gap: 8px; }
  .pz-b { min-height: 36px; padding: 0 12px; border: 1px solid #000a; border-radius: 4px; cursor: pointer; color: var(--paper);
    font: 400 9px var(--f-px); letter-spacing: 0.08em; text-transform: uppercase; background: linear-gradient(#3d3843, #25212a); box-shadow: inset 0 1px 0 #ffffff22, 0 2px 0 #000a; }
  .pz-b:hover { background: linear-gradient(#48424f, #2c2731); }
  .pz-b:active { transform: translateY(1px); box-shadow: inset 0 1px 0 #ffffff14, 0 1px 0 #000a; }
  .pz-b:focus-visible, .pz-tag:focus-visible, .pz-t:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  .pz-b[hidden] { display: none; }
  .pz-sq { width: 40px; padding: 0; display: grid; place-items: center; }
  .pz-arr { width: 0; height: 0; border: 6px solid transparent; border-right: 9px solid var(--paper); border-left-width: 0; }
  .pz-arr.r { border-right-width: 0; border-left: 9px solid var(--paper); }
  .pz-save { color: var(--amber); }
  .pz.naming .pz-save { box-shadow: inset 0 0 0 1px var(--amber), 0 2px 0 #000a; }
  .pz-lcd .pz-b { min-height: 34px; }
  .pz-del.armed { background: var(--r); color: var(--ink); }
  .pz-say { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: 0; }
  /* the banks: a rail down the side (a strip across on a phone), one bank's tiles beside it */
  .pz { grid-template-columns: minmax(200px, 250px) minmax(0, 1fr); align-items: start; }
  .pz-unit { grid-column: 1 / -1; }
  .pz-tags { display: grid; gap: 2px; padding: 4px; border-radius: 5px; background: #141117; box-shadow: inset 0 0 0 1px var(--line); }
  .pz-tag { display: grid; grid-template-columns: 8px auto minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 32px; padding: 0 10px; border: 0; border-radius: 3px;
    background: transparent; color: var(--dim); cursor: pointer; text-align: left; font: 400 13px/1.2 inherit; }
  .pz-tag i { width: 8px; height: 8px; border-radius: 2px; background: var(--c); box-shadow: 0 0 0 1px #0009; }
  .pz-tag-n { font: 400 8px var(--f-px); letter-spacing: 0.06em; color: var(--faint); }
  .pz-tag-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pz-tag small { font: 400 11px var(--f-mono); color: var(--faint); }
  .pz-tag:hover { color: var(--paper); background: #ffffff0a; }
  .pz-tag[aria-pressed="true"] { color: var(--paper); background: linear-gradient(90deg, color-mix(in srgb, var(--c) 22%, transparent), #ffffff08); box-shadow: inset 3px 0 0 var(--c); }
  .pz-tag[aria-pressed="true"] .pz-tag-n { color: var(--amber); }
  .pz-mid { display: grid; gap: 8px; min-width: 0; align-content: start; }
  .pz-about { margin: 0; color: var(--faint); font-size: 13px; }
  .pz-about b { font: 400 9px var(--f-px); letter-spacing: 0.08em; color: var(--dim); margin-right: 6px; }
  /* the tiles */
  .pz-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(156px, 1fr)); gap: 8px; }
  .pz-t { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); align-content: start; gap: 3px 8px; min-height: 70px; padding: 8px 10px 9px; text-align: left;
    border: 1px solid var(--line); border-radius: 5px; color: var(--paper); cursor: pointer; font: inherit;
    background: linear-gradient(#221e27, #19161d); box-shadow: 0 2px 0 #0008; transition: transform 0.1s, border-color 0.1s; }
  .pz-t:hover { border-color: var(--line2); transform: translateY(-1px); }
  .pz-t-n { display: flex; align-items: center; gap: 5px; font: 400 8px/1 var(--f-px); color: var(--faint); letter-spacing: 0.06em; }
  .pz-t-n::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #4a3410; box-shadow: inset 0 1px 1px #0008; }
  .pz-t-fx { grid-row: 1; grid-column: 2; justify-self: end; align-self: center; display: flex; gap: 3px; min-height: 8px; }
  .pz-t-fx i { width: 8px; height: 8px; border-radius: 2px; background: var(--c); box-shadow: 0 0 0 1px #0009; }
  .pz-t-name { grid-column: 1 / -1; font: 400 16px/1.1 ${FONTS.dirt}; overflow: hidden; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; } /* (two lines, as the studio's drawer: long names read whole) */
  .pz-t-amp { grid-column: 1 / -1; font-size: 11px; line-height: 1.2; color: var(--dim); }
  .pz-t[aria-checked="true"] { border-color: var(--amber); background: linear-gradient(#2d2415, #1c170f); box-shadow: inset 0 0 0 1px var(--amber), 0 0 16px #ffb64830, 0 2px 0 #0008; }
  .pz-t[aria-checked="true"] .pz-t-n { color: var(--amber); }
  .pz-t[aria-checked="true"] .pz-t-n::before { background: var(--amber); box-shadow: 0 0 6px 1px #ffb648aa; }
  .pz-t.edited .pz-t-name::after { content: ' *'; color: var(--amber); }
  .pz-t.hot { background: linear-gradient(135deg, #2e2040, #19161d 60%); border-color: #6b4d93; }
  .pz-t.hot[aria-checked="true"] { background: linear-gradient(135deg, #3a2a4a, #1c170f 70%); border-color: var(--amber); }
  .pz-hot { grid-column: 1 / -1; font: 400 7px/1.2 var(--f-px); letter-spacing: 0.08em; text-transform: uppercase; color: #d7b6ff; }
  .pz-none { margin: 0; color: var(--dim); font-size: 14px; }
  .pz-none[hidden] { display: none; }
  @media (max-width: 560px) {
    .pz-unit { grid-template-columns: minmax(0, 1fr); padding: 10px; }
    .pz-ctl { flex-wrap: nowrap; }
    .pz-ctl .pz-b { flex: 1 1 auto; padding: 0 8px; }
    .pz-ctl .pz-sq { flex: 0 0 44px; }
    .pz-name { font-size: 16px; }
    .pz-form { flex-wrap: wrap; }
    .pz-lab { display: none; }
    .pz-in { flex: 1 1 100%; }
    .pz-form .pz-b { flex: 1 1 0; }
    .pz-t { padding: 7px 8px 8px; }
    .pz-t-name { font-size: 14px; }
    .pz { grid-template-columns: minmax(0, 1fr); }
    .pz-tags { display: flex; overflow-x: auto; scrollbar-width: none; }
    .pz-tag { flex: 0 0 auto; grid-template-columns: 8px auto auto auto; }
    .pz-about { font-size: 12px; }
    .pz-list { grid-template-columns: none; grid-auto-flow: column; grid-template-rows: repeat(2, auto); grid-auto-columns: calc(50% - 14px); overflow-x: auto;
      scroll-snap-type: x proximity; padding-bottom: 6px; scrollbar-width: thin; }
    .pz-t { scroll-snap-align: start; }
  }`;
