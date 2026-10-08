// Extreme metal. The format: core/grooves.js's header. Blasts with the snare on eighths at the felt tempo (each limb
// on eighths: a sixteenth grid at 180-260 BPM), the Swedish d-beat, double kick under ride and China, and fills of
// sixteenth triplets and thirty-seconds over the feet. Written for Studio A's note map; `kit metal` plays it on Rusty
// Sticks where the studio has it.
export default `
style extreme  Extreme metal
blurb   blast beats (traditional, hammer, bomb, gravity), the d-beat, and double kick under the ride and the China
tempo   180-260
feel    blast, driving, double kick, extreme
swing   none
lay     hat -2  kick -1
human   2ms 4%
kit     metal
studio  Arena

intro   Floor toms over double kick  1 bar
  tom3   x.x. x.x. x.x. x.x.
  floor  x.x. x.x. x.x. x.x.
  kick   xxxx xxxx xxxx xxxx

verse   Traditional blast  1 bar
  ride   x.x. x.x. x.x. x.x.
  snare  .x.x .x.x .x.x .x.x
  kick   x.x. x.x. x.x. x.x.

verse   Hammer blast  1 bar
  ride   x.x. x.x. x.x. x.x.
  snare  x.x. x.x. x.x. x.x.
  kick   x.x. x.x. x.x. x.x.

verse   Swedish d-beat  1 bar
  tempo  160-220
  feel   d-beat, driving
  ride   x.x. x.x. x.x. x.x.
  snare  .... X... .... X...
  kick   x... ..x. x... ..x.

verse   Gravity blast  1 bar
  tempo  170-210
  feel   blast, gravity, one-handed roll
  crash  X... x... X... x...
  snare  XxXx XxXx XxXx XxXx
  kick   x... x... x... x...

chorus  Bomb blast  1 bar
  china  x.x. x.x. x.x. x.x.
  snare  x.x. x.x. x.x. x.x.
  kick   xxxx xxxx xxxx xxxx

chorus  Double kick under the ride  1 bar
  ride   x.x. x.x. x.x. x.x.
  bell   x... .... x... ....
  snare  .... X... .... X...
  kick   xxxx xxxx xxxx xxxx

chorus  Double kick under the China  1 bar
  china  X... x... X... x...
  snare  .... X... .... X...
  kick   xxxx xxxx xxxx xxxx

bridge  Floor toms and feet  1 bar
  ride   x... x... x... x...
  floor  x.x. x.x. x.x. x.x.
  snare  .... .... X... ....
  kick   xxxx xxxx xxxx xxxx

fill    Snare thirty-seconds  1 beat
  snare  xxxxxxxx
  kick   xxxx

fill    Sixteenth-triplet run  2 beats
  snare  xxxxxx ......
  tom1   ...... xxx...
  floor  ...... ...xxX
  kick   xxxx xxxx

fill    Thirty-seconds round the kit, feet under  1 bar
  snare  xxxxxxxx ........ ........ ........
  tom1   ........ xxxxxxxx ........ ........
  tom3   ........ ........ xxxxxxxx ........
  floor  ........ ........ ........ xxxxxxxX
  kick   xxxx xxxx xxxx xxxx

ending  Blast into a crash  2 bars
  ride   x.x. x.x. x.x. .... | .... .... .... ....
  snare  .x.x .x.x .x.x xxxx | .... .... .... ....
  crash  .... .... .... .... | X... .... .... ....
  china  .... .... .... .... | X... .... .... ....
  kick   x.x. x.x. x.x. xxxx | X... .... .... ....
`;
