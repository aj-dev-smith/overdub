// Rigs: every clawd-o-matic preset, from every bank, as a chain of Overdub devices in signal order (the pedals before
// the amp, the amp, the pedals after it). The classic `fx: { gate, drive, ... }` presets come out as the classic board
// (gate, drive, fuzz, amp, chorus, delay, reverb) with the ones they don't use switched off, as clawd-o-matic shows them.
//   RIGS                 [{ id, name, bank: { id, name, color, blurb }, blurb, nod, tags, hot, amp, chain: [{ device, params, on }] }]
//   rigOps(track, rig, { replace: [insertIds], index }) -> ops that put the chain on a track (or 'master'), as one
//                        transaction: insert.remove for each id in replace (the rig it replaces), then insert.add each.
//   rigById(id)
import { clawd } from './clawd.js';
import { ampParams } from './amps.js';

function rigOf(p, banks) {
  const S = clawd.presetResolve(p);
  const chain = [];
  for (const e of S.board) {
    if (e.id === 'amp') { chain.push({ device: 'amp.' + S.amp, params: ampParams(S), on: true }); continue; }
    const def = clawd.PEDAL_DEFS[e.id];
    if (!def) continue;
    const params = {};
    for (const k of def.knobs) if (e[k.key] != null) params[k.key] = e[k.key];
    chain.push({ device: 'pedal.' + e.id, params, on: !!e.on });
  }
  const b = banks[p.bank] || { id: p.bank, name: p.bank, color: '#ffb347', blurb: '' };
  return {
    id: p.id, name: p.name, bank: { id: b.id, name: b.name, color: b.color, blurb: b.blurb || '' },
    blurb: p.blurb || '', nod: p.nod || '', tags: (p.tags || []).slice(), hot: p.hot || null, amp: 'amp.' + S.amp, chain,
  };
}

const BANKS = Object.fromEntries(clawd.PRESET_BANKS.map((b) => [b.id, b]));
export const RIGS = clawd.PLUG_PRESETS.map((p) => rigOf(p, BANKS));
export const RIG_BANKS = clawd.PRESET_BANKS.map((b) => ({ id: b.id, name: b.name, color: b.color, blurb: b.blurb || '', count: RIGS.filter((r) => r.bank.id === b.id).length })).filter((b) => b.count);
export const rigById = (id) => RIGS.find((r) => r.id === id) || null;

export function rigOps(trackId, rig, { replace = [], index } = {}) {
  if (typeof rig === 'string') rig = rigById(rig);
  if (!rig) throw new Error('rigOps: no such rig');
  const ops = replace.map((id) => ({ type: 'insert.remove', track: trackId, insert: id }));
  rig.chain.forEach((s, k) => {
    const op = { type: 'insert.add', track: trackId, insert: { device: s.device, params: Object.assign({}, s.params), on: s.on } };
    if (index != null) op.index = index + k;
    ops.push(op);
  });
  return ops;
}
