// Neo-soul. The format: core/grooves.js's header. The lay line is the feel: the snare well behind the beat.
export default `
style neosoul  Neo-soul
blurb   lazy and behind the beat: a late snare, loose swung hats, ghost notes, a kick that leans
tempo   68-96
feel    laid back, behind the beat, swung sixteenths
swing   16 60-56%
lay     snare +24  hat +10  kick +4
human   7ms 10%
kit     acoustic room .25 tone -.25
studio  Dead 70s

intro   Hats and rim  1 bar
  hat    x.xx x.x. x.xx x.x.
  stick  .... X... .... X...

verse   Behind the beat  1 bar
  hat    x.xx x.x. x.xx x.x.
  snare  .... X..o .o.. X...
  kick   X... ..x. .x.. ..x.

verse   Leaning kick  2 bars
  hat    x.xx x.x. x.xx x.x. | x.xx x.x. x.xx x.xx
  snare  ..o. X..o ..o. X... | ..o. X..o .o.. X.o.
  kick   X..x .... ..x. .... | X... ..x. ...x ....

chorus  Open up  1 bar
  hat    x.x. x... x.x. x...
  open   .... ..x. .... ..x.
  snare  .... X..o .o.. X...
  clap   .... x... .... x...
  kick   X..x ..x. .x.. ..x.

bridge  Shaker and rim  1 bar
  shaker xxxx xxxx xxxx xxxx
  stick  .... X... .... X..o
  kick   X... .... ..x. ....

half    Half-time drag  1 bar
  feel   half-time, laid back
  hat    x.xx x.x. x.xx x.x.
  snare  .o.. .o.. X... .o.o
  kick   X... ..x. .... ....

fill    Ghost drag  1 beat
  snare  oo.X

fill    Lazy toms  2 beats
  tom1   x..x ....
  tom2   ..x. x...
  floor  .... ..xX

fill    Sixteenth chops  1 bar
  snare  oxo. xox. .... ....
  tom1   ...x ...x xx.. ....
  floor  .... .... ..xx xx..
  kick   x... x... x... ..x.

ending  Lay it down  2 bars
  hat    x.xx x.x. x.xx .... | .... .... .... ....
  snare  .... X..o .o.. oxoX | .... .... .... ....
  crash  .... .... .... .... | X... .... .... ....
  kick   X... ..x. .x.. .... | X... .... .... ....
`;
