// The house shelf: devices Claude wrote the way any agent writes them (kernel source against the public dsp stdlib,
// from one plain-language request each, signed by: 'claude'), shipped with the studio so every song can use them.
// Importing this module registers them all. Ids are forever ('claude.<slug>'); display names may change.
//
//   instruments: claude.choir-loft (Choir Loft), claude.biscuit-tin (Biscuit Tin), claude.dust-sheet (Dust Sheet),
//                claude.sub-basement (Sub Basement)
//   effects:     claude.charity-shop (Charity Shop), claude.skylight (Skylight), claude.chopping-block (Chopping Block),
//                claude.power-cut (Power Cut), claude.say-ahh (Say Ahh), claude.leading-edge (Leading Edge)
//
// Each def carries the `request` that asked for it. Every one passes kernel/check.js at house levels (instruments
// -14 to -18 LUFS on the test phrase, effects within 1.5 LU of bypass, true peaks at or under -1 dBTP, tails that
// die, bit-exact renders): tools/library-test.js checks that, and writes the summaries the library page shows
// (reports.js) when run with WRITE=1.
import { defineDevice } from '../registry.js';
import choirLoft from './choir-loft.js';
import biscuitTin from './biscuit-tin.js';
import dustSheet from './dust-sheet.js';
import subBasement from './sub-basement.js';
import charityShop from './charity-shop.js';
import skylight from './skylight.js';
import choppingBlock from './chopping-block.js';
import powerCut from './power-cut.js';
import sayAhh from './say-ahh.js';
import leadingEdge from './leading-edge.js';

export const LIB_INSTRUMENTS = [choirLoft, biscuitTin, dustSheet, subBasement];
export const LIB_EFFECTS = [charityShop, skylight, choppingBlock, powerCut, sayAhh, leadingEdge];
export const LIBRARY = [...LIB_INSTRUMENTS, ...LIB_EFFECTS];

// source 'library': shipped with the studio (like the built-ins), but written by an agent, so faces wear its badge
export const LIBRARY_DEFS = LIBRARY.map((d) => defineDevice({ ...d, source: 'library' }));
export default LIBRARY_DEFS;
