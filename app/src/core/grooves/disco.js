// Disco. The format: core/grooves.js's header.
export default `
style disco  Disco
blurb   four on the floor, the open hat on every and, sixteenths in between, snare on 2 and 4
tempo   108-130
feel    four on the floor, straight sixteenths
swing   none
lay     hat -2
human   3ms 5%
kit     acoustic room .2 tone .2
studio  Dry and tight

intro   Hats in  1 bar
  hat    xx.x xx.x xx.x xx.x
  open   ..x. ..x. ..x. ..x.
  kick   X... X... X... X...

verse   Four on the floor  1 bar
  hat    xx.x xx.x xx.x xx.x
  open   ..x. ..x. ..x. ..x.
  snare  .... X... .... X...
  kick   X... X... X... X...

chorus  Claps and tambourine  1 bar
  art    open half
  hat    xx.x xx.x xx.x xx.x
  open   ..x. ..x. ..x. ..x.
  snare  .... X... .... X...
  clap   .... x... .... x...
  tamb   xxxx xxxx xxxx xxxx
  kick   X... X... X... X...

bridge  Toms on the off  1 bar
  hat    x.x. x.x. x.x. x.x.
  tom2   ..x. ..x. ..x. ..x.
  snare  .... X... .... X...
  kick   X... X... X... X...

fill    Snare sixteenths  1 beat
  snare  xxxX

fill    Snare and toms  2 beats
  snare  xxxx ....
  tom1   .... xx..
  floor  .... ..xX
  kick   X... X...

fill    Build  1 bar
  snare  oooo xxxx xxxx XXXX
  kick   X... X... X... X...

ending  Hold it  2 bars
  hat    xx.x xx.x xx.x .... | .... .... .... ....
  open   ..x. ..x. ..x. .... | .... .... .... ....
  snare  .... X... .... xxxX | .... .... .... ....
  crash  .... .... .... .... | X... .... .... ....
  kick   X... X... X... X... | X... .... .... ....
`;
