// Blues shuffle. The format: core/grooves.js's header. Groups of three cells are eighth-note triplets: the 12/8 feel.
export default `
style shuffle  Blues shuffle
blurb   a triplet shuffle in a twelve-eight feel: the hat on the first and last of each triplet, backbeat on 2 and 4
tempo   70-140
feel    shuffle, triplets, twelve-eight
swing   none
lay     snare +6
human   5ms 8%
accent  hat 1 .6 .6 .78
kit     acoustic room .35 tone -.05
studio  Maple 70s

intro   Shuffle on the hat  1 bar
  hat    x.x x.x x.x x.x
  kick   X.. ... X.. ...

verse   Shuffle  1 bar
  hat    x.x x.x x.x x.x
  snare  ... X.. ... X..
  kick   X.. ..x X.. ...

chorus  Double shuffle  1 bar
  ride   x.x x.x x.x x.x
  snare  ..o X.o ..o X.o
  kick   X.. ..x X.. ..x

bridge  Ride and stick  1 bar
  ride   x.x x.x x.x x.x
  stick  ... X.. ... X..
  kick   X.. ... x.. ...

half    Slow twelve-eight  1 bar
  feel   half-time, twelve-eight
  hat    xxx xxx xxx xxx
  snare  ... ... X.. ...
  kick   X.. ..x ... ...

fill    Triplet pickup  1 beat
  snare  xxX

fill    Triplet roll  2 beats
  snare  xxx x..
  tom2   ... .x.
  floor  ... ..X

fill    Turnaround  1 bar
  snare  Xxx ... ... ...
  tom1   ... xxx ... ...
  tom2   ... ... xxx ...
  floor  ... ... ... xxX
  kick   x.. x.. x.. x..

ending  Blues ending  2 bars
  hat    x.x x.x ... ... | ... ... ... ...
  snare  ... X.. xxx xxX | ... ... ... ...
  crash  ... ... ... ... | X.. ... ... ...
  kick   X.. ... X.. ... | X.. ... ... ...
`;
