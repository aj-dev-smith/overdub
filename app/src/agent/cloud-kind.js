// @ts-check
// What kind of ask this is, for Claude on Overdub credits: the price is shown on the ask before it's sent
// ("A new part · 5 credits ▾"), so the page names the kind itself, from open rules, in the browser. Nothing of the
// draft leaves the page until Send. The person can always pick another kind from the ▾; the service then runs that
// kind's route (a quick change can't write a new part: it says so and stops). The prices are the service's
// (GET /v1/config), never here.
//
//   classify({ text, hint }) -> { kind, why, alternatives: KINDS }
//   freeMove(text, { devices, hasTrack }) -> { tool: 'adjust', input } | { device } | null
//     the quick moves typed as words, run free and never sent: one lexicon word ("warmer", "make it brighter") on the
//     selection, or "use / load / add / try <name>" naming a device exactly

import { WORDS } from './lexicon.js';

export const KINDS = ['quick_change', 'question', 'new_part', 'new_instrument'];

const MAKE = /^(make|build|write|design|create|code)$/;
const INSTRUMENT =
  /^(synths?|instruments?|pedals?|effects?|fx|plugins?|reverbs?|delays?|distortions?|fuzz(es)?|compressors?|filters?|devices?)$/;
const NOT_MAKING = /^(use|load|find|try)$/;
const PART_VERB = /^(add|write|make|compose)$/;
const PART =
  /^(bass|basslines?|melod(y|ies)|counter|counter-?melod(y|ies)|harmon(y|ies)|parts?|tracks?|lines?|riffs?|chorus|verses?|intros?|outros?|drums?|beats?|pads?|arps?)$/;
const TAKES = /\b(takes|variations|options|versions)\b/;
const QUESTION_START = /^(why|what|how|which|is|does|should|can you tell)\b/;
const NEAR = 5; // words between the verb and what it makes

const words = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[“”"’']/g, '')
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
// is there a making verb with one of `nouns` up to NEAR words after it (and no "use"/"load"/… between)?
function makes(ws, verb, nouns, { giveMe = false } = {}) {
  for (let i = 0; i < ws.length; i++) {
    const isVerb = verb.test(ws[i]) || (giveMe && ws[i] === 'give' && ws[i + 1] === 'me');
    if (!isVerb) continue;
    for (let j = i + 1; j <= Math.min(ws.length - 1, i + NEAR + (ws[i] === 'give' ? 1 : 0)); j++) {
      if (NOT_MAKING.test(ws[j])) break;
      if (nouns.test(ws[j])) return true;
    }
  }
  return false;
}

export function classify({ text = '', hint = null } = {}) {
  if (hint && KINDS.includes(hint)) return { kind: hint, why: 'picked', alternatives: KINDS };
  const t = String(text).trim().toLowerCase();
  const ws = words(t);
  if (ws.some((w) => NOT_MAKING.test(w)) && !ws.some((w) => MAKE.test(w))) {
    /* using a device is not making one */
  } else if (makes(ws, MAKE, INSTRUMENT)) return { kind: 'new_instrument', why: 'makes a device', alternatives: KINDS };
  if (makes(ws, PART_VERB, PART, { giveMe: true }) || TAKES.test(t))
    return { kind: 'new_part', why: 'makes a part', alternatives: KINDS };
  const verb = ws.some((w) => MAKE.test(w) || PART_VERB.test(w));
  if ((t.endsWith('?') || QUESTION_START.test(t)) && !verb)
    return { kind: 'question', why: 'asks', alternatives: KINDS };
  return { kind: 'quick_change', why: 'changes something', alternatives: KINDS };
}

// Exact forms only: anything looser is an ask for the agent (and gets the price chip).
export function freeMove(text, { devices = [], hasTrack = false } = {}) {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, '')
    .replace(/\s+/g, ' ');
  if (!t) return null;
  const use = /^(use|load|add|try) (?:the |a |an )?(.+)$/.exec(t);
  if (use) {
    const name = use[2].trim();
    const d = devices.find((x) => x && typeof x.name === 'string' && x.name.toLowerCase() === name);
    if (d && (d.kind === 'instrument' || hasTrack)) return { device: d.id, kind: d.kind, name: d.name };
  }
  if (!hasTrack) return null;
  const word = /^make it (.+)$/.exec(t)?.[1] || t;
  const known = (w) => Object.prototype.hasOwnProperty.call(WORDS, w);
  if (known(word)) return { tool: 'adjust', input: { axis: word, reason: `you asked for ${word}` } };
  return null;
}
