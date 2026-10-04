// Jazz. The format: core/grooves.js's header. Swing tightens as the tempo rises (68% slow, 55% fast).
export default `
style jazz  Jazz
blurb   the ride's spang-a-lang, the hat foot on 2 and 4, a feathered kick, the snare comping
tempo   100-240
feel    swung eighths, ride, comping
swing   8 68-55%
lay     ride -6  pedal -14  snare +2
human   6ms 9%
accent  ride 1 .72 .6
kit     acoustic room .45 decay 1.2 tone -.1
studio  Jazz club

intro   Ride alone  1 bar
  ride   x... x.x. x... x.x.
  pedal  .... x... .... x...

verse   Spang-a-lang  1 bar
  ride   x... x.x. x... x.x.
  pedal  .... x... .... x...
  kick   g... g... g... g...

verse   Comping  2 bars
  ride   x... x.x. x... x.x. | x... x.x. x... x.x.
  pedal  .... x... .... x... | .... x... .... x...
  snare  .... ..o. .... .... | ..o. .... .... ..x.
  kick   g... g... g... g... | g... g... g..x g...

chorus  Shout  1 bar
  ride   x... x.x. x... x.x.
  crash  .... .... .... ..x.
  pedal  .... x... .... x...
  snare  .... ..o. ..o. ....
  kick   g... g... g... ..x.

bridge  Latin bridge  2 bars
  swing  none
  feel   straight, latin
  ride   x.x. x.x. x.x. x.x. | x.x. x.x. x.x. x.x.
  stick  X... ..X. .... X... | .... X... ..X. ....
  kick   x... ..o. x... ..o. | x... ..o. x... ..o.

half    Two feel  1 bar
  feel   two feel, half-time
  ride   x... x.x. x... x.x.
  pedal  .... x... .... x...
  kick   o... .... o... ....

fill    Snare triplet  1 beat
  snare  xxX

fill    Triplets round the toms  2 beats
  snare  xx. ...
  tom1   ..x x..
  floor  ... .xX

fill    Trading  1 bar
  snare  Xxx x.x ... ...
  tom1   ... ... xxx ...
  floor  ... ... ... xx.
  kick   ... .x. ... ..X

ending  Button  2 bars
  ride   x... x.x. x... .... | .... .... .... ....
  snare  .... .... ..o. xxX. | .... .... .... ....
  crash  .... .... .... .... | X... .... .... ....
  kick   g... g... g... .... | X... .... .... ....
`;
