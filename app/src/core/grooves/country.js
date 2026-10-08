// @ts-check
// Country. The format: core/grooves.js's header. The train beat: sixteenths on the snare, 2 and 4 on top.
export default `
style country  Country
blurb   the train beat: sixteenths on the snare with 2 and 4 on top, kick on one and three; boom-chick in the chorus
tempo   90-160
feel    train, straight sixteenths
swing   16 52%
lay     snare -1
human   4ms 8%
kit     acoustic room .3 tone -.1 decay .8
studio  Maple 70s

intro   Train pulling out  1 bar
  snare  oooo oooo oooo xxxx
  kick   x... .... x... ....

verse   Train beat  1 bar
  snare  oooo Xooo oooo Xooo
  pedal  .... x... .... x...
  kick   X... .... X... ....

chorus  Boom-chick  1 bar
  hat    x.x. x.x. x.x. x.x.
  snare  .... X... .... X...
  kick   X... .... X... ....

bridge  Ride and stick  1 bar
  ride   x.x. x.x. x.x. x.x.
  stick  .... X... .... X...
  kick   X... .... X... ....

half    Half-time train  1 bar
  feel   half-time
  snare  oooo oooo Xooo oooo
  kick   X... .... .... ....

fill    Snare pickup  1 beat
  snare  oxxX

fill    Snare roll  2 beats
  snare  oxox xxxX

fill    Roll to the one  1 bar
  snare  oooo oxox xxxx xxXX
  kick   X... .... X... ....

ending  Train stops  2 bars
  snare  oooo Xooo oooo xxXX | .... .... .... ....
  crash  .... .... .... .... | X... .... .... ....
  kick   X... .... X... .... | X... .... .... ....
`;
