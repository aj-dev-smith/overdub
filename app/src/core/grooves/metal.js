// Metal. The format: core/grooves.js's header. Two feet on the kick: sixteenths, gallops, blasts.
export default `
style metal  Metal
blurb   double kick sixteenths under a snare on 2 and 4, a crash or china riding eighths, gallops and blasts
tempo   100-200
feel    double kick, driving
swing   none
lay     hat -2  kick -1
human   3ms 5%
kit     acoustic room .3 tone .35 drive .4
studio  Arena

intro   Toms and double kick  1 bar
  floor  x.x. x.x. x.x. x.x.
  kick   xxxx xxxx xxxx xxxx

verse   Double kick  1 bar
  hat    x.x. x.x. x.x. x.x.
  snare  .... X... .... X...
  kick   xxxx xxxx xxxx xxxx

verse   Gallop  1 bar
  ride   x.x. x.x. x.x. x.x.
  snare  .... X... .... X...
  kick   x.xx x.xx x.xx x.xx

chorus  Crash riding  1 bar
  crash  x.x. x.x. x.x. x.x.
  snare  .... X... .... X...
  kick   xxxx xxxx xxxx xxxx

chorus  Blast  1 bar
  tempo  150-220
  ride   x.x. x.x. x.x. x.x.
  snare  .x.x .x.x .x.x .x.x
  kick   x.x. x.x. x.x. x.x.

bridge  Tom groove  1 bar
  tom1   x... .... x... ....
  floor  ..x. x.x. ..x. x.x.
  snare  .... X... .... X...
  kick   x.x. x.x. x.x. x.x.

half    Breakdown  1 bar
  feel   half-time, breakdown
  china  x... x... x... x...
  snare  .... .... X... ....
  kick   X.xx .... .xx. x...

fill    Double-kick flurry  1 beat
  snare  xxxx
  kick   xxxx

fill    Toms over the feet  2 beats
  tom1   xxxx ....
  floor  .... xxxX
  kick   xxxx xxxx

fill    Round the kit, feet under  1 bar
  snare  xxxx .... .... ....
  tom1   .... xxxx .... ....
  tom2   .... .... xxxx ....
  floor  .... .... .... xxxX
  kick   xxxx xxxx xxxx xxxx

ending  Crash out  2 bars
  crash  x.x. x.x. .... .... | X... .... .... ....
  snare  .... X... xxxx xxxX | .... .... .... ....
  china  .... .... .... .... | X... .... .... ....
  kick   xxxx xxxx xxxx xxxx | X... .... .... ....
`;
