// House. The format: core/grooves.js's header. A machine: little humanising, a little shuffle on the sixteenths.
export default `
style house  House
blurb   a 909 four on the floor, claps on 2 and 4, the open hat on the off-beat, shuffled sixteenths
tempo   118-130
feel    four on the floor, shuffled
swing   16 54%
lay     clap +2
human   1ms 4%
kit     909 tone .2 room .15

intro   Kick in  1 bar
  hat    xx.x xx.x xx.x xx.x
  kick   X... X... X... X...

verse   Jack  1 bar
  hat    xx.x xx.x xx.x xx.x
  open   ..x. ..x. ..x. ..x.
  clap   .... X... .... X..o
  kick   X... X... X... X...

chorus  Full  1 bar
  hat    xx.x xx.x xx.x xx.x
  open   ..x. ..x. ..x. ..x.
  clap   .... X... .... X...
  shaker xxxx xxxx xxxx xxxx
  ride   ..x. ..x. ..x. ..x.
  kick   X... X... X... X...

bridge  Breakdown  1 bar
  hat    xx.x xx.x xx.x xx.x
  open   ..x. ..x. ..x. ..x.
  clap   .... X... .... X...
  shaker xxxx xxxx xxxx xxxx

fill    Clap flam  1 beat
  clap   .xxX
  kick   X...

fill    Snare roll  2 beats
  snare  oooo xxxX
  kick   X... X...

fill    Snare build  1 bar
  snare  o.o. o.o. oooo xxXX
  kick   X... X... X... X...

ending  Kick out  2 bars
  hat    xx.x xx.x xx.x xx.x | .... .... .... ....
  open   ..x. ..x. ..x. ..x. | .... .... .... ....
  clap   .... X... .... X... | .... .... .... ....
  crash  .... .... .... .... | X... .... .... ....
  kick   X... X... X... X... | X... .... .... ....
`;
