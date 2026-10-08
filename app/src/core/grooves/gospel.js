// @ts-check
// Gospel. The format: core/grooves.js's header. Groups of six cells are sixteenth triplets: the chops.
export default `
style gospel  Gospel
blurb   church pocket: swung sixteenths, a heavy backbeat with ghost notes, and chops in sixteenth triplets round the kit
tempo   70-140
feel    swung sixteenths, pocket, chops
swing   16 60-55%
lay     snare +6
human   5ms 9%
kit     acoustic room .3 tone .2
studio  Birch modern

intro   Hats and claps  1 bar
  hat    x.xx x.xx x.xx x.xx
  clap   .... X... .... X...

verse   Pocket  1 bar
  hat    x.xx x.xx x.xx x.xx
  snare  .o.. X..o .o.. X.o.
  kick   X... ..x. ..x. ...x

chorus  Ride and crash  1 bar
  ride   x.x. x.x. x.x. x.x.
  crash  .... .... .... ..x.
  snare  .o.. X..o .o.. X...
  kick   X..x ..x. X..x ..x.

bridge  Claps and tambourine  1 bar
  tamb   x.x. x.x. x.x. x.x.
  clap   .... X... .... X...
  kick   X... .... ..x. ....

half    Half-time pocket  1 bar
  feel   half-time
  hat    x.xx x.xx x.xx x.xx
  snare  .o.. .o.o X..o .o..
  kick   X... ..x. .... ..x.

fill    Chop  1 beat
  snare  xxxxxX

fill    Chops round the toms  2 beats
  snare  xx.... ......
  tom1   ..xx.. ......
  tom2   ....xx ......
  floor  ...... xxxxxX

fill    Gospel chops  1 bar
  snare  xx.x.. xx.x.. ...... x.x.x.
  tom1   ..x... ..x... xx.... ......
  floor  ....x. ....x. ..xx.. ......
  kick   .....x .....x ....xx .x.x.X

ending  Church ending  2 bars
  hat    x.xx x.xx .... .... | .... .... .... ....
  snare  .o.. X..o xxxxxx xxxxxX | .... .... .... ....
  crash  .... .... .... .... | X... .... .... ....
  kick   X... ..x. x..... x..... | X... .... .... ....
`;
