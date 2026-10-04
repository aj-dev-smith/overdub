// The generic editor: every device without an editor of its own gets this one in its window (ui/plugin.js), the
// built-ins, the house shelf, the Guitar Studio's pedals and amps, and whatever an agent writes. It is built only
// from the window's ctx, exactly as a custom editor is, so it is also the example to copy:
//
//   export function mount(el, ctx) -> { update(evt), frame(now), unmount() }
//
// Its controls come from ctx.control(key), which binds each one to the device (set, the lanes, the menu, the agent's
// flash), so update() and frame() have nothing left to do here.
//
// Sections. A device that names its own (a param's `group`: an amp's 'cab'), or whose keys share prefixes (a_*,
// flt_*, env1_*: at least two params to a prefix), is laid out that way, with what's left in "Main" (an amp's "Amp")
// after. Otherwise eight params or fewer are one row, and more are grouped by role (Sound, Tone, Envelope, Movement,
// Space or Voice, Level); a section of one joins its neighbour, except an effect's output level. Switches sit over the
// knobs in each section. layout(def) -> [{ name | null, keys }] is what the window shows (and what show_device tells
// an agent).

import { h, css } from '../dom.js';

const FAMILY = {
  shape: 'sound', pitch: 'sound', tone: 'tone', drive: 'tone', attack: 'env', decay: 'env', release: 'env', gate: 'env',
  rate: 'move', depth: 'move', size: 'space', time: 'space', feedback: 'space', width: 'space', mix: 'level', level: 'level', sens: 'level',
};
const FAMILY_NAME = { sound: 'Sound', tone: 'Tone', env: 'Envelope', move: 'Movement', space: 'Space', voice: 'Voice', level: 'Level', other: 'More' };
// what a key prefix or a group id reads as
const NAMES = {
  a: 'Osc A', b: 'Osc B', c: 'Osc C', osc: 'Oscillator', sub: 'Sub', noise: 'Noise', nz: 'Noise', wt: 'Wavetable',
  flt: 'Filter', filt: 'Filter', filter: 'Filter', f: 'Filter', env: 'Envelope', aenv: 'Amp envelope', fenv: 'Filter envelope',
  lfo: 'LFO', mod: 'Modulation', mtx: 'Mod matrix', mx: 'Mod matrix', mac: 'Macros', macro: 'Macros', m: 'Mod slots',
  fx: 'FX', dly: 'Delay', delay: 'Delay', rev: 'Reverb', verb: 'Reverb', cho: 'Chorus', chorus: 'Chorus', dist: 'Distortion',
  drv: 'Drive', comp: 'Compressor', eq: 'EQ', uni: 'Unison', voice: 'Voice', vel: 'Velocity', amp: 'Amp', out: 'Output',
  master: 'Output', mst: 'Output', glide: 'Glide', arp: 'Arpeggiator',
  kick: 'Kick', snare: 'Snare', sn: 'Snare', hat: 'Hats', hh: 'Hats', tom: 'Tom', ride: 'Ride', crash: 'Crash',
  oh: 'Overheads', room: 'Room', cl: 'Close mics', close: 'Close mics', mic: 'Mics', bleed: 'Bleed', kit: 'Kit',
  cab: 'Cab and mics',
};
// a numbered one reads as one of them: m1_* is "Mod slot 1" (a modulation slot's source, destination and amount, as
// Light Table's are), macro2 "Macro 2"
const ONE = { m: 'Mod slot', mac: 'Macro', macro: 'Macro' };
const title = (s) => String(s).replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
export function sectionName(id) {
  const s = String(id || '').trim().slice(0, 40);
  if (!/^[a-z0-9_-]+$/.test(s)) return s || 'Main';   // a group a device named in words keeps its words
  if (NAMES[s]) return NAMES[s];
  const m = /^([a-z]+)(\d+)$/.exec(s);
  if (m && (ONE[m[1]] || NAMES[m[1]])) return `${ONE[m[1]] || NAMES[m[1]]} ${m[2]}`;
  return title(s);
}
const prefixOf = (k) => { const m = /^([a-z]+\d*)_/i.exec(String(k)); return m ? m[1].toLowerCase() : null; };

export function layout(def) {
  const ps = (def?.params || []).filter((p) => p && !p.hidden);
  if (!ps.length) return [];
  const counts = new Map();
  for (const p of ps) { const pre = prefixOf(p.key); if (pre) counts.set(pre, (counts.get(pre) || 0) + 1); }
  const groupOf = (p) => (typeof p.group === 'string' && p.group.trim() ? 'g:' + p.group.trim() : prefixOf(p.key) && counts.get(prefixOf(p.key)) >= 2 ? 'p:' + prefixOf(p.key) : null);
  if (ps.some(groupOf)) {
    const order = [], by = new Map();
    for (const p of ps) {
      const g = groupOf(p) || 'main';
      if (!by.has(g)) { by.set(g, []); if (g !== 'main') order.push(g); }
      by.get(g).push(p.key);
    }
    const out = order.map((g) => ({ name: sectionName(g.slice(2)), keys: by.get(g) }));
    if (by.has('main')) out.push({ name: def.cat === 'amp' ? 'Amp' : 'Main', keys: by.get('main') });
    // (an amp's own panel reads first: its knobs, then the cab)
    if (def.cat === 'amp') out.sort((x, y) => (y.name === 'Amp') - (x.name === 'Amp'));
    return out;
  }
  if (ps.length <= 8) return [{ name: null, keys: ps.map((p) => p.key) }];
  // by role: families in the order they first appear
  const inst = def.kind === 'instrument';
  const fam = (p) => {
    if (p.key === 'sustain') return 'env';
    const f = FAMILY[p.role] || 'other';
    return inst && f === 'space' ? 'voice' : f;
  };
  let secs = [];
  for (const [i, p] of ps.entries()) {
    const f = fam(p);
    let s = secs.find((x) => x.fam === f);
    if (!s) { s = { fam: f, first: i, keys: [] }; secs.push(s); }
    s.keys.push({ key: p.key, i });
  }
  // a section of one joins its neighbour in the param order (the one before it, or after it when it comes first),
  // except an effect's level: an output knob reads best on its own, last
  let merged = true;
  while (merged && secs.length > 1) {
    merged = false;
    for (const s of secs) {
      if (s.keys.length !== 1 || (s.fam === 'level' && !inst)) continue;
      const i = s.keys[0].i;
      const others = secs.filter((x) => x !== s);
      const before = others.filter((x) => x.keys.some((k) => k.i < i)).sort((a, b) => Math.max(...b.keys.filter((k) => k.i < i).map((k) => k.i)) - Math.max(...a.keys.filter((k) => k.i < i).map((k) => k.i)))[0];
      const into = before || others.sort((a, b) => a.first - b.first)[0];
      into.keys.push(s.keys[0]); into.keys.sort((a, b) => a.i - b.i);
      into.first = Math.min(into.first, s.first);
      secs = others;
      merged = true;
      break;
    }
  }
  secs.sort((a, b) => (a.fam === 'level' && !inst ? 1 : 0) - (b.fam === 'level' && !inst ? 1 : 0) || a.first - b.first);
  if (secs.length === 1) return [{ name: null, keys: secs[0].keys.map((k) => k.key) }];
  return secs.map((s) => ({ name: FAMILY_NAME[s.fam], keys: s.keys.map((k) => k.key) }));
}

// An envelope among a section's params: attack and release (decay and sustain too, when it has them) that are
// times, by key ('attack', 'env1_a', 'amp_rel'). -> { attack, decay?, sustain?, release } keys, or null
const ENV_KEYS = { attack: /(^|_)(attack|atk|att|a)$/, decay: /(^|_)(decay|dec|d)$/, sustain: /(^|_)(sustain|sus|s)$/, release: /(^|_)(release|rel|r)$/ };
export function envelopeOf(keys, param) {
  const out = {};
  for (const [part, re] of Object.entries(ENV_KEYS)) {
    const k = keys.find((x) => re.test(x));
    if (!k) continue;
    const p = param(k);
    if (!p || p.opts) continue;
    if (part !== 'sustain' && !(p.unit === 's' || p.unit === 'ms' || p.curve === 'log')) continue;
    out[part] = k;
  }
  return out.attack && out.release ? out : null;
}

let n = 0;
export function mount(el, ctx) {
  css('plugin-generic', CSS);
  const def = ctx.def;
  const secs = layout(def);
  const count = (def.params || []).filter((p) => !p.hidden).length;
  const size = count <= 4 ? 72 : count <= 8 ? 62 : 54;
  const root = h('div.pg', { dataset: { sections: String(secs.length) } });
  const graphs = [];
  for (const s of secs) {
    const sw = [], kn = [];
    for (const k of s.keys) {
      const p = ctx.param(k);
      const c = ctx.control(k, { size });
      if (!c) continue;
      (p.opts || p.tap ? sw : kn).push(c);
    }
    // an envelope gets its shape drawn beside its knobs, to drag as well as turn
    const env = s.name && envelopeOf(s.keys, ctx.param);
    let graph = null;
    if (env) {
      const keys = Object.values(env);
      const g = ctx.kit.envelope({
        label: s.name, showLabel: false, readout: false, name: def.name,
        attack: ctx.param(env.attack), decay: env.decay && ctx.param(env.decay), sustain: env.sustain && ctx.param(env.sustain), release: ctx.param(env.release),
        value: ctx.params(),
        onInput: (patch, { commit }) => ctx.set(patch, { gesture: commit ? 'end' : 'move' }),
      });
      graphs.push({ g, keys });
      graph = g.el;
    }
    const id = `pg-h-${++n}`;
    root.append(h('section.pg-sec', s.name ? { 'aria-labelledby': id } : { 'aria-label': `${def.name} controls` },
      s.name ? h('h3.pg-h', { id }, s.name) : null,
      sw.length ? h('div.pg-sw', sw) : null,
      graph || kn.length ? h('div.pg-kn', graph, kn) : null));
  }
  if (!secs.length) root.append(h('div.empty', h('p', `${def.name} has no controls: it plays as it is.`)));
  const blurb = typeof def.blurb === 'string' ? def.blurb.trim() : '';
  const about = [blurb && !/[.!?]$/.test(blurb) ? blurb + '.' : blurb, typeof def.nod === 'string' && def.nod ? `Tips its hat to ${def.nod}.` : ''].filter(Boolean).join(' ');
  if (about) root.append(h('p.pg-about', about));
  el.append(root);
  // the drawn envelopes follow their knobs (a turn, an agent, an undo, a lane playing)
  const off = ctx.on((evt) => { for (const x of graphs) if (evt.keys?.some((k) => x.keys.includes(k))) x.g.set(evt.params); });
  return { update() {}, frame() {}, unmount() { off(); for (const x of graphs) x.g.destroy(); root.remove(); } };
}

const CSS = `
/* the generic editor: sections on a grid of hairlines (each rules its top and left; the outer rules are clipped) */
.pg { display: flex; flex-wrap: wrap; align-content: flex-start; min-height: 100%; overflow: hidden; }
.pg-sec { flex: 1 1 auto; min-width: 0; margin: -1px 0 0 -1px; padding: 16px 20px 18px; border-top: var(--rule); border-left: var(--rule); }
.pg[data-sections="1"] .pg-sec { flex-basis: 100%; padding: 22px 24px 20px; }
.pg-h { margin: 0 0 14px; font: 600 13px/1.2 var(--font-ui); color: var(--text-2); }
.pg-sw { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px 18px; margin-bottom: 16px; }
.pg-kn { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 18px 14px; }
.pg-about { flex-basis: 100%; margin: -1px 0 0 -1px; padding: 12px 20px 16px; border-top: var(--rule); border-left: var(--rule); font-size: 12.5px; line-height: 1.5; color: var(--text-3); contain: inline-size; }
.pw-phone .pg-sec { flex-basis: 100%; padding: 14px 16px 16px; }
.pw-phone .pg-h { font-size: 13px; }
.pw-phone .pg-about { font-size: 12.5px; padding: 12px 16px 16px; }
`;
