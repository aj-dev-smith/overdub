// Lo-fi. The format: core/grooves.js's header. Dusty and late.
export default `
style lofi  Lo-fi
blurb   slow and dusty: a soft kick and snare, lazy swung hats, a rim click, everything a little late
tempo   64-90
feel    swung sixteenths, laid back, dusty
swing   16 62-58%
lay     snare +14  hat +6
human   6ms 10%
kit     dust room .2 tone -.35 decay .9

intro   Hats and rim  1 bar
  hat    x.xx x.x. x.xx x.x.
  stick  .... X... .... X..o

verse   Dusty  1 bar
  hat    x.xx x.x. x.xx x.x.
  snare  .... X... .... X...
  kick   X... ..x. ..x. ....

verse   Rim click  2 bars
  hat    x.xx x.x. x.xx x.x. | x.xx x.x. x.xx x.xx
  stick  .... X... .... X... | .... X... .... X...
  kick   X... ...x ..x. .... | X... ..x. .x.. ....

chorus  Fuller  1 bar
  hat    x.xx x.x. x.xx x...
  open   .... .... .... ..x.
  snare  .... X..o .... X...
  kick   X..x ..x. ..x. ....

bridge  Hats alone  1 bar
  hat    x.xx x.x. x.xx x.x.
  shaker ..x. ..x. ..x. ..x.
  kick   X... .... .... ....

half    Half-time  1 bar
  feel   half-time
  hat    x.xx x.x. x.xx x.x.
  snare  .... .... X... ....
  kick   X... .... ..x. ....

fill    Kick skip  1 beat
  kick   x.xx

fill    Snare drag  2 beats
  snare  .... oo.X
  kick   x..x ....

fill    Drop out  1 bar
  hat    x.xx x.x. .... ....
  snare  .... X... .... ..oX
  kick   X... .... .... ....

ending  Last rim  1 bar
  stick  X... .... .... ....
  kick   X... .... .... ....
`;
