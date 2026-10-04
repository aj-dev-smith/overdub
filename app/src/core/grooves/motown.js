// Motown. The format: core/grooves.js's header. The snare on every beat, the tambourine with it on 2 and 4.
export default `
style motown  Motown
blurb   the snare on every beat with a tambourine on 2 and 4, eighth hats, the kick on one and three with a push
tempo   100-140
feel    straight, four on the snare
swing   none
lay     snare +2  tamb +4
human   5ms 8%
kit     acoustic room .35 tone .05
studio  Maple 70s

intro   Snare and tambourine  1 bar
  snare  x... X... x... X...
  tamb   .... X... .... X...

verse   Four on the snare  1 bar
  hat    x.x. x.x. x.x. x.x.
  snare  x... X... x... X...
  tamb   .... X... .... X...
  kick   X... ..x. X... ..x.

chorus  Tambourine eighths  1 bar
  hat    x.x. x.x. x.x. x.x.
  snare  x... X... x... X...
  tamb   x.x. X.x. x.x. X.x.
  kick   X..x ..x. X..x ..x.

bridge  Backbeat  1 bar
  hat    x.x. x.x. x.x. x.x.
  snare  .... X... .... X...
  tamb   .... X... .... X...
  kick   X... ..x. X... ....

fill    Snare pickup  1 beat
  snare  .xxx

fill    Snare eighths  2 beats
  snare  x.x. xxxX

fill    Snare and toms  1 bar
  snare  F.x. x.x. xxxx ....
  tom1   .... .... .... xx..
  floor  .... .... .... ..xX
  kick   X... ..x. X... ....

ending  Ride it out  2 bars
  hat    x.x. x.x. x.x. .... | .... .... .... ....
  snare  x... X... x... xxxX | .... .... .... ....
  tamb   .... X... .... .... | .... .... .... ....
  crash  .... .... .... .... | X... .... .... ....
  kick   X... ..x. X... .... | X... .... .... ....
`;
