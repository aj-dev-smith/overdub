// Samba. The format: core/grooves.js's header. The kick is the surdo: soft on one, strong on two, a sixteenth before each.
export default `
style samba  Samba
blurb   the surdo's heartbeat in the kick, sixteenths on the hat, a partido-alto cross-stick; felt in two
tempo   92-126
feel    straight sixteenths, Brazilian, in two
swing   none
lay     kick -2
human   4ms 8%
accent  hat 1 .62 .82
kit     acoustic room .3 tone .05
studio  Big room

intro   Surdo and hat  1 bar
  hat    xxxx xxxx xxxx xxxx
  kick   o..x X..x o..x X..x

verse   Batucada kit  1 bar
  hat    xxxx xxxx xxxx xxxx
  stick  x..x ..x. ..x. .x..
  kick   o..x X..x o..x X..x

verse   Partido alto  2 bars
  hat    x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.x.
  stick  x..x ..x. .... .... | x..x ..x. ..x. .x..
  kick   o..x X..x o..x X..x | o..x X..x o..x X..x

chorus  Ride and snare  1 bar
  ride   x.x. x.x. x.x. x.x.
  snare  oxoo xoxo oxoo xoxO
  kick   o..x X..x o..x X..x

bridge  Hat and rim, in two  1 bar
  hat    x.x. x.x. x.x. x.x.
  stick  .... X... .... X...
  kick   o..x X... o..x X...

fill    Snare sixteenths  1 beat
  snare  xxxX

fill    Toms  2 beats
  tom1   xx.. ....
  tom2   ..xx ....
  floor  .... xxxX

fill    Batucada break  1 bar
  snare  x.x. x.x. .... ....
  tom1   .x.x .x.x .... ....
  floor  .... .... xxxx xxxX
  kick   o..x X..x o..x X...

ending  Final hit  2 bars
  hat    xxxx xxxx xxxx .... | .... .... .... ....
  snare  .... .... .... xxxX | .... .... .... ....
  crash  .... .... .... .... | X... .... .... ....
  kick   o..x X..x o..x .... | X... .... .... ....
`;
