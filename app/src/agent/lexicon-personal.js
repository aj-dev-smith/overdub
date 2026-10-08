// @ts-check
// The personal lexicon: what THIS person means by the words people disagree on. docs/UX-RESEARCH.md §7 (P1, "personal
// lexicon learned by A/B"): "warm" is the most-taught word in SocialEQ but only 10th for agreement, so the studio asks
// once, with two audible readings (agent/lexicon.js READINGS), and keeps the pick.
//
//   meaning('warm')              -> { word, reading, label, opposite, axis, dir, picks, uses, at, edited } | null
//   learn('warm', 'darker_top')  the person picked that reading on an A/B card (counts it, makes it their meaning)
//   noteUse('warm')              their meaning was used without asking (counts it)
//   setMeaning('warm', id)       they changed it by hand (Agent settings › Your words)
//   forget('warm')               gone: the next "warmer" asks again
//   list()                       [{ word, reading, label, picks, uses, at, options: [{ id, label }] }] for the settings list
//   forAgents()                  the JSON outside agents read (get_guide "lexicon" → personal)
//   onChange(fn) -> off          after any change here or in another tab
//
// Stored in this browser only: localStorage 'overdub:lexicon-personal' = { v: 1, words: { warm: { reading, picks:
// { darker_top: 2 }, uses, at, edited? } } }. Unknown words or reading ids are dropped on read. Importable in Node
// (no localStorage there: it keeps the data in memory).

import { READINGS } from './lexicon.js';

export const KEY = 'overdub:lexicon-personal';
let memory = null; // the fallback when localStorage is missing or blocked
const listeners = new Set();

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}
function read() {
  let raw = memory;
  const s = storage();
  if (s) {
    try {
      raw = s.getItem(KEY);
    } catch {
      /* blocked: memory */
    }
  }
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  const words = {};
  for (const [w, e] of Object.entries((data && data.words) || {})) {
    const rs = READINGS[w];
    if (!rs || !e || !rs.some((r) => r.id === e.reading)) continue;
    const picks = {};
    for (const r of rs) if (Number(e.picks?.[r.id]) > 0) picks[r.id] = Math.floor(Number(e.picks[r.id]));
    words[w] = {
      reading: e.reading,
      picks,
      uses: Math.max(0, Math.floor(Number(e.uses) || 0)),
      at: Number(e.at) || 0,
      ...(e.edited ? { edited: true } : {}),
    };
  }
  return { v: 1, words };
}
function write(data) {
  const raw = JSON.stringify(data);
  memory = raw;
  const s = storage();
  if (s) {
    try {
      s.setItem(KEY, raw);
    } catch {
      /* full or blocked: memory keeps it for this page */
    }
  }
  emit();
}
function emit() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.error('lexicon-personal listener', e);
    }
  }
}

const reading = (w, id) => (READINGS[w] || []).find((r) => r.id === id) || null;
const rootOf = (w) =>
  String(w || '')
    .toLowerCase()
    .trim();

export function meaning(word) {
  const w = rootOf(word),
    e = read().words[w];
  if (!e) return null;
  const r = reading(w, e.reading);
  const picks = Object.values(e.picks).reduce((a, b) => a + b, 0);
  return {
    word: w,
    reading: r.id,
    label: r.label,
    opposite: r.opposite,
    axis: r.axis,
    dir: r.dir,
    picks,
    uses: e.uses,
    at: e.at,
    edited: !!e.edited,
  };
}

export function learn(word, id) {
  const w = rootOf(word);
  if (!reading(w, id)) return null;
  const data = read();
  const e = data.words[w] || { reading: id, picks: {}, uses: 0, at: 0 };
  e.picks[id] = (e.picks[id] || 0) + 1;
  e.reading = id;
  e.at = Date.now();
  delete e.edited;
  data.words[w] = e;
  write(data);
  return meaning(w);
}

export function noteUse(word) {
  const w = rootOf(word),
    data = read();
  if (!data.words[w]) return null;
  data.words[w].uses++;
  write(data);
  return meaning(w);
}

export function setMeaning(word, id) {
  const w = rootOf(word);
  if (!reading(w, id)) return null;
  const data = read();
  const e = data.words[w] || { reading: id, picks: {}, uses: 0, at: 0 };
  e.reading = id;
  e.at = Date.now();
  e.edited = true;
  data.words[w] = e;
  write(data);
  return meaning(w);
}

export function forget(word) {
  const w = rootOf(word),
    data = read();
  if (!data.words[w]) return false;
  delete data.words[w];
  write(data);
  return true;
}

export function clear() {
  write({ v: 1, words: {} });
}

export function list() {
  return Object.keys(read().words)
    .sort()
    .map((w) => {
      const m = meaning(w);
      return {
        word: w,
        reading: m.reading,
        label: m.label,
        picks: m.picks,
        uses: m.uses,
        at: m.at,
        edited: m.edited,
        options: READINGS[w].map((r) => ({ id: r.id, label: r.label })),
      };
    });
}

// What an outside agent needs to honour the person's words: the meaning, the adjust call that makes it, the other way.
export function forAgents() {
  const words = {};
  for (const x of list()) {
    const r = reading(x.word, x.reading);
    words[x.word] = {
      means: r.label.toLowerCase(),
      reading: r.id,
      opposite: (r.opposite || '').toLowerCase(),
      adjust: { axis: r.axis, direction: r.dir > 0 ? 'more' : 'less' },
      picked: x.picks,
      used: x.uses,
      ...(x.edited ? { set_by_hand: true } : {}),
      not: READINGS[x.word].filter((o) => o.id !== r.id).map((o) => o.label.toLowerCase()),
    };
  }
  return {
    words,
    asks: Object.keys(READINGS).filter((w) => !words[w]),
    note: 'What this person means by words people disagree on, learned from their own A/B picks. adjust uses it without asking (and says so); if you make the move another way, follow it. Words under "asks" are not learned yet: adjust will offer two audible readings.',
  };
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// another tab changed it: tell this one's listeners (the settings list)
try {
  globalThis.addEventListener?.('storage', (e) => {
    if (e.key === KEY || e.key === null) emit();
  });
} catch {
  /* Node */
}
