// @ts-check
// Drum and bass. The format: core/grooves.js's header. The two-step: kick on one and the and of three.
export default `
style dnb  Drum and bass
blurb   the two-step at 170: kick on one and the and of three, snare on 2 and 4, ghost notes, a ride on top
tempo   160-178
feel    two-step, breakbeat
swing   none
lay     snare +2
human   2ms 6%
kit     acoustic room .1 tone .3 decay .7
studio  Dry and tight

intro   Ride and ghosts  1 bar
  ride   x.x. x.x. x.x. x.x.
  snare  .... .o.. .... ..o.

verse   Two-step  1 bar
  hat    x.x. x.x. x.x. x.x.
  snare  .... X... .... X...
  kick   X... .... ..x. ....

verse   Break  2 bars
  hat    x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.x.
  snare  .... X..o .o.. X... | .o.. X..o .... X.o.
  kick   X.x. .... ..x. .... | X.x. .... ..x. ..x.

chorus  Ride and push  1 bar
  ride   x.x. x.x. x.x. x.x.
  snare  .... X..o .o.. X...
  kick   X.x. .... ..xx ....

bridge  Rollers  1 bar
  hat    xxxx xxxx xxxx xxxx
  snare  .... X... .... X...
  kick   X... .... ..x. ...x

half    Halftime  1 bar
  feel   half-time
  hat    x.x. x.x. x.x. x.x.
  snare  .... .... X... ....
  kick   X... .... .... ..x.

fill    Snare sixteenths  1 beat
  snare  xxxX

fill    Rush  2 beats
  snare  xxxx xx..
  tom1   .... ..xX

fill    Snare roll  1 bar
  snare  xxxx xxxx xxxx xxXX
  kick   X... .... X... ....

ending  Drop out  1 bar
  crash  X... .... .... ....
  kick   X... .... .... ....
`;
