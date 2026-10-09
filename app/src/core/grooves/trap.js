// @ts-check
// Trap. The format: core/grooves.js's header. A group of 6 cells is sixteenth triplets, 8 is thirty-seconds.
export default `
style trap  Trap
blurb   half-time snare on three, eighth hats with rolls in triplets and thirty-seconds, an 808 kick that skips
tempo   130-160
feel    half-time, hat rolls
swing   none
human   2ms 6%
kit     808 decay 1.8 room .1

intro   Hats and rolls  1 bar
  hat    x.x. x.x. x.x. oxxxxX
  kick   X... .... .... ....

verse   Rolls  1 bar
  hat    x.x. x.x. x.x. oxxxxX
  clap   .... .... X... ....
  kick   X... ...x .... x.x.

verse   Thirty-seconds  2 bars
  hat    x.x. x.x. ooxxxxXX x.x. | x.x. x.x. x.x. oxoxxX
  clap   .... .... X... .... | .... .... X... ....
  kick   X... .... ..x. .... | X..x .... .... ..x.

chorus  Busy kick  1 bar
  hat    xxxx xxxx xxxx xxxxxx
  clap   .... .... X... ....
  snare  .... .... x... ....
  kick   X..x ..x. ..x. .xx.

bridge  Space  1 bar
  hat    x... x... x... x...
  clap   .... .... X... ....
  kick   X... .... .... ....

half    Quarter-time  2 bars
  feel   half-time, half again
  hat    x.x. x.x. x.x. x.x. | x.x. x.x. x.x. xxxxxx
  clap   .... .... .... .... | .... .... X... ....
  kick   X... .... ..x. .... | X... ...x .... ....

fill    Hat roll  1 beat
  hat    ooxxxxXX

fill    Snare triplets  2 beats
  snare  oxxxxx xxxxxX
  kick   x..... ......

fill    808 roll  1 bar
  hat    x.x. x.x. xxxxxx xxxxxxxx
  clap   .... .... X... ....
  kick   X... ..x. x.x. xxxx

ending  Last 808  1 bar
  clap   X... .... .... ....
  kick   X... .... .... ....
`;
