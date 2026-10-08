// The groove library's style files, in the order the panel lists them. Each file is one family in the text format
// core/grooves.js documents; add a style by adding a file here. [file, text] pairs, so a parse error names its file.
import rock from './rock.js';
import pop from './pop.js';
import indie from './indie.js';
import punk from './punk.js';
import metal from './metal.js';
import funk from './funk.js';
import motown from './motown.js';
import disco from './disco.js';
import gospel from './gospel.js';
import neosoul from './neosoul.js';
import boombap from './boombap.js';
import lofi from './lofi.js';
import trap from './trap.js';
import house from './house.js';
import dnb from './dnb.js';
import dubstep from './dubstep.js';
import jazz from './jazz.js';
import shuffle from './shuffle.js';
import country from './country.js';
import reggae from './reggae.js';
import bossa from './bossa.js';
import samba from './samba.js';
import afrobeat from './afrobeat.js';

export const TEXTS = [
  ['rock', rock], ['pop', pop], ['indie', indie], ['punk', punk], ['metal', metal],
  ['funk', funk], ['motown', motown], ['disco', disco], ['gospel', gospel], ['neosoul', neosoul],
  ['boombap', boombap], ['lofi', lofi], ['trap', trap], ['house', house], ['dnb', dnb], ['dubstep', dubstep],
  ['jazz', jazz], ['shuffle', shuffle], ['country', country], ['reggae', reggae], ['bossa', bossa],
  ['samba', samba], ['afrobeat', afrobeat],
];
