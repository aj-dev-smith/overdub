// @ts-check
// Bossa nova. The format: core/grooves.js's header. The cross-stick plays the bossa clave across two bars.
export default `
style bossa  Bossa nova
blurb   the bossa clave on the cross-stick over two bars, a soft kick on one and the and of two, eighths on the hat
tempo   110-150
feel    straight, light, Brazilian
swing   none
lay     stick +4
human   4ms 7%
kit     acoustic room .3 tone -.2 decay .8
studio  Jazz club

intro   Hat and kick  2 bars
  hat    x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.x.
  kick   x... ..o. x... ..o. | x... ..o. x... ..o.

verse   Bossa  2 bars
  hat    x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.x.
  stick  X... ..X. .... X... | .... X... ..X. ....
  kick   x... ..o. x... ..o. | x... ..o. x... ..o.

verse   Two-three  2 bars
  hat    x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.x.
  stick  .... X... ..X. .... | X... ..X. .... X...
  kick   x... ..o. x... ..o. | x... ..o. x... ..o.

chorus  Ride  2 bars
  ride   x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.x.
  stick  X... ..X. .... X... | .... X... ..X. ....
  pedal  .... x... .... x... | .... x... .... x...
  kick   x... ..o. x... ..o. | x... ..o. x... ..o.

bridge  Ride sixteenths  1 bar
  ride   x.xx x.xx x.xx x.xx
  stick  .... X... .... X...
  kick   x... ..o. x... ..o.

fill    Rim pickup  1 beat
  stick  ..xx

fill    Toms  2 beats
  tom2   x.x. ....
  floor  .... x.xX
  kick   x... ....

fill    Tom samba  1 bar
  tom1   x.x. .... x.x. ....
  tom2   .x.x .... .x.x ....
  floor  .... xxxx .... xx.X
  kick   x... ..o. x... ..o.

ending  Rim button  2 bars
  hat    x.x. x.x. x.x. x.x. | .... .... .... ....
  stick  X... ..X. .... X... | X... .... .... ....
  kick   x... ..o. x... ..o. | X... .... .... ....
`;
