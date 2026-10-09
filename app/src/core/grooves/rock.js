// @ts-check
// Rock: the format is core/grooves.js's header (style lines, then grooves: one row per piece, a group of cells per beat).
export default `
style rock  Rock
blurb   straight eighths, sixteenths or half-time, and a big backbeat on 2 and 4
tempo   88-160
feel    straight, driving
swing   none
lay     snare +3  hat -2
human   5ms 7%
kit     acoustic room .35
studio  Arena

intro   Floor tom drive  1 bar
  floor  x.x. x.x. x.x. x.x.
  snare  .... .... .... X...
  kick   X... .... X... ....

verse   Straight eighths  1 bar
  hat    x.x. x.x. x.x. x.x.
  snare  .... X... .... X...
  kick   X... .... X.x. ....

verse   Sixteenths  1 bar
  tempo  84-118
  hat    xxxx xxxx xxxx xxxx
  snare  .... X... .... X...
  kick   X... ..x. X... ..x.

chorus  Ride and push  1 bar
  bell   X... X... X... X...
  ride   ..x. ..x. ..x. ..x.
  snare  .... X... .... X...
  kick   X.x. ..x. X.x. ..x.

chorus  Half-open hats  1 bar
  art    open half
  open   x.x. x.x. x.x. x.x.
  snare  .... X... .... X...
  kick   X... ..x. X.x. ..x.

bridge  Floor tom  1 bar
  floor  x.x. x.x. x.x. x.x.
  snare  .... X... .... X...
  kick   X... .... X... ....

half    Half-time  1 bar
  feel   half-time
  hat    x.x. x.x. x.x. x.x.
  snare  .... .... X... ....
  kick   X... ..x. .... ..x.

fill    Snare pickup  1 beat
  snare  oxxX

fill    Down the toms  2 beats
  snare  xx.. ....
  tom1   ..xx ....
  tom2   .... xx..
  floor  .... ..xX
  kick   .... x...

fill    Round the kit  1 bar
  snare  Fxxx Xxxx .... ....
  tom1   .... .... xxx. ....
  tom2   .... .... ...x xx..
  floor  .... .... .... ..xX
  kick   X... .... .... x...

ending  Big finish  2 bars
  hat    x.x. x.x. .... .... | .... .... .... ....
  snare  .... X... oxxx XxxX | .... .... .... ....
  crash  .... .... .... .... | X... .... .... ....
  kick   X... .... x... .... | X... .... .... ....
`;
