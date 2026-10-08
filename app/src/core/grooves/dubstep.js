// @ts-check
// Dubstep, riddim and melodic bass. The format: core/grooves.js's header. Half-time at 140: the kick on one, the snare
// on three of each bar, which makes a bar of 140 feel like 70. Plays on Sandbag (core.clubkit), kit DUBSTEP.
export default `
style dubstep  Dubstep
blurb   half-time at 140: the kick on one, the snare on three, the hats in eighths; riddim's triplet stabs, the build's snare roll
tempo   138-152
feel    half-time, heavy, bass music
swing   none
lay     snare +3
human   2ms 5%
kit     club kit 0 room .35
tags    bass music, riddim, melodic bass, brostep

intro   Hats and a kick  1 bar
  hat    x.x. x.x. x.x. x.x.
  kick   X... .... .... ....

verse   Build roll  4 bars
  snare  x... x... x... x... | x.x. x.x. x.x. x.x. | xxxx xxxx xxxx xxxx | xxxxxxxx xxxxxxxx xxxxxxxx XXXXXXXX
  kick   X... x... x... x... | X... x... x... x... | X... x... x... x... | X... .... .... ....

half    Half-time  1 bar
  hat    x.x. x.x. x.x. x.x.
  snare  .... .... X... ....
  kick   X... .... .... ....

half    Half-time push  2 bars
  hat    x.x. x.x. x.x. x.x. | x.x. x.x. x.xx x.x.
  snare  .... .... X... .... | .... .... X... ..o.
  kick   X... .... .... ..x. | X..x .... .... ....

half    Riddim  1 bar
  hat    x.x. x.x. x.x. x.x.
  snare  .... .... X... ....
  kick   X.x .x. ... x..

half    Riddim triplets  2 bars
  hat    x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.x.
  snare  .... .... X... .... | .... .... X... ....
  kick   X.x .x. ... x.. | X.x ... ... xx.

half    Melodic  1 bar
  open   ..x. .... ..x. ....
  hat    x... x.x. x... x.x.
  snare  .... .... X... ....
  kick   X... .... .... ..x.

chorus  Switch-up (two-step)  1 bar
  hat    x.x. x.x. x.x. x.x.
  snare  .... .... X... ....
  kick   X... .... ..x. ....
  clap   .... .... x... ....

bridge  Break  1 bar
  hat    x... x... x... x...
  rim    .... .... x... ....
  kick   X... .... .... ....

fill    Snare triplets  1 beat
  snare  xxX

fill    Tom run  2 beats
  tom1   xx.. ....
  tom2   ..xx ....
  floor  .... xxX.

fill    Snare roll  1 bar
  snare  x.x. x.x. xxxx xxXX
  kick   X... .... X... ....

ending  Crash out  1 bar
  crash  X... .... .... ....
  kick   X... .... .... ....
`;
