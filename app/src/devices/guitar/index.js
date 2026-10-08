// @ts-check
// The Guitar Studio in Overdub: one import registers every pedal ('pedal.<id>') and every amp ('amp.<id>') from
// clawd-o-matic, and exports the rigs (its presets as device chains).
//
//   import { RIGS, rigOps, PEDALS, AMPS } from './devices/guitar/index.js';
//
// The sources are clawd-o-matic's, verbatim (app/vendor/clawd/, synced by tools/vendor-clawd.js); the sound runs on
// devices/kit.js + devices/graph.js. Credit: AJ's clawd-o-matic Guitar Studio (pedals, amps, cabs, presets).
import { registerPedals } from './pedals.js';
import { registerAmps, AMP_PARAMS, ampSettings, ampParams, CAB_IDS, MIC_IDS } from './amps.js';
import { RIGS, RIG_BANKS, rigOps, rigById } from './rigs.js';
import { clawd, setSongKey, majorKeyOf } from './clawd.js';

export const PEDALS = registerPedals();
export const AMPS = registerAmps();
export {
  RIGS,
  RIG_BANKS,
  rigOps,
  rigById,
  AMP_PARAMS,
  ampSettings,
  ampParams,
  CAB_IDS,
  MIC_IDS,
  clawd,
  setSongKey,
  majorKeyOf,
};
