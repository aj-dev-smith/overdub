# Sandbag: a club kit for bass music

Sandbag (`core.clubkit`) is a synthesized drum kit for dubstep, riddim, drum and bass and melodic bass. Gobo Kit's
kits are classic machines and an acoustic studio; bass music asks for something else: a kick with a sub tail tuned to
the song and a click that cuts through a growl, and a big layered snare. The device is
`app/src/devices/builtin/clubkit.js`; `tools/clubkit-test.js` holds it to everything below.

## What the drum audit asked for

The house's drum audit measured where Gobo Kit's drums fall short of real ones, and three of its findings matter most
in this genre:

- Gobo's kicks are squashed: a crest factor of 2.6 to 4.9 dB over their first 100 ms, where a real kick has 11.2.
- Its snares ring their wires for over a second and are squashed too (crest 4.6 to 7.6 dB; real snares 13 to 17,
  their wires ringing 0.2 to 0.5 s).
- Its hats have nothing under 3 kHz (42 to 58 dB under their loudest band).

And three rules from the synthesis research: every hit peaks within a few milliseconds; a voice ends when it has
fallen quiet, never at a fixed length; ring time falls with frequency.

## What it is

- **Kick.** A sine whose pitch falls from about five times the kick's note into the note within 60 ms. The fall has
  two parts, a fast one (3 ms) for the knock and a slower one (9 to 13 ms) into the note, so the tail is within a few
  cents of KICK NOTE once the knock is over. Its level is the knock (falling to a fifth over 15 to 20 ms) times the
  tail (the kit's T60, 0.3 to 0.72 s). DRIVE saturates it a little, which gives a small speaker harmonics to play.
  CLICK adds a 1.2 ms high-passed noise tick and a 4 ms blip at 2.2 to 3.6 kHz.
- **Snare.** (Velocity moves its brightness: a harder hit rings the upper mode more, with a brighter crack, a sharper stick and more clap; soft hits are mostly body, as a real snare's are.) Two membrane modes for the body (the kit's 182 to 235 Hz and 1.594 times that), gliding down a few
  percent in their first 20 ms. A noise crack, high-passed (1.3 to 2.2 kHz) and darkened, with a T60 of 0.16 to 0.2 s
  and a 0.8 ms stick at its front. A clap (CLAP): three band-passed bursts 9.5 and 20.5 ms apart and a short tail. A
  room (ROOM): four damped combs a side and two allpasses, with a one-pole in each loop so its highs die first.
- **Hats.** The research's H2: two plates of 48 modes, 120 Hz to 17 kHz (the second 7% higher), each mode ringing
  T60 = T(h) x (f/4 kHz)^-0.0985 x U(0.7, 1.3), each mode's level tilted up by f^0.3; the stick's contact time sets the
  bright edge (4.2 / tc), so the top is as strong as the body, as a real closed hat's is (a first version struck at
  1.4 / tc with no tilt measured a centroid of 2.9 kHz and its 12-20 kHz 23 dB under its 150-600 Hz: dull); a chatter of
  noise band-passed at 7 kHz follows the plates; each mode is heard by the two mics with its own gains. Closed (42),
  pedal (44) and open (46) are one hat, so a closed stroke chokes an open one (38 dB down 300 ms later). T(h) runs from
  0.28 to 0.42 s closed to 2.4 s open.
- **Toms**, falling sines with a second membrane mode; the **crash** and **ride** are metal.js's FDN models; a
  **riser** (note 34) sweeps a band-pass through noise from 300 Hz to 9 kHz over four bars at the song's tempo, and an
  **impact** (note 33) is a sub boom falling an octave with a noise burst and a long dark room.
- **The bus**: the side under about 250 Hz taken out (a 4th-order high pass on the side: club systems sum the low end,
  so the kit's is mono, the snare's body and room included); a soft clipper (2x oversampled), set per kit, that takes the loudest peaks' first milliseconds (on the
  RIDDIM kit's drum phrase the crest factor drops, the timing doesn't move); then LEVEL.

## What was measured

At full velocity, each hit alone (`tools/clubkit-test.js`):

| kit | kick: peak, crest over 100 ms, tail after 60 ms | snare: peak, crest, T60 over 2.5 kHz, body | hats: 150 Hz-2.5 kHz, 12-20 kHz against 150-600 Hz, centroid (first 30 ms), L/R correlation | drum phrase |
|---|---|---|---|---|
| DUBSTEP | 1.5 ms, 10.3 dB, -15 cents from F1 | 0.4 ms, 12.4 dB, 0.24 s, 192 Hz | 0 dB under the loudest band, +0.4 dB, 5.4 kHz, 0.30 | -18.0 LUFS, -1.5 dBTP |
| RIDDIM | 1.3 ms, 10.3 dB, -14 cents | 0.4 ms, 13.0 dB, 0.25 s, 205 Hz | 0 dB, +0.5 dB, 5.4 kHz, 0.30 | -17.9 LUFS, -1.0 dBTP |
| DNB | 1.5 ms, 11.2 dB, -13 cents | 0.4 ms, 13.8 dB, 0.23 s, 235 Hz | 0 dB, +0.6 dB, 5.4 kHz, 0.30 | -18.5 LUFS, -1.4 dBTP |
| MELODIC | 1.8 ms, 10.4 dB, -15 cents | 0.4 ms, 12.3 dB, 0.29 s, 182 Hz | 0 dB, +0.2 dB, 5.4 kHz, 0.30 | -18.1 LUFS, -2.0 dBTP |

Targets (the spec's, from the audit's real hits): a kick peaks within 5 ms with a crest of 10 dB or more and a tail
within 25 cents of its note; a snare peaks within 5 ms with a crest of 12 dB or more, its wires ringing 0.5 s or less
and its body at 150 to 300 Hz; hats within 30 dB under 2.5 kHz, their 12-20 kHz within 6 dB of their 150-600 Hz (the
real hats: -0.7 and +6.1) and correlating 0.5 or less. Every piece ends 60 dB or
more under its peak (nothing is cut off): the last 50 ms before each one stops measure 70 dB or more under its peak.

## What is not done

- The crests are at the bottom of the real range (10 to 11 dB for the kick against 11.2, 12.3 to 13.8 for the snare
  against 13 to 17). They were reached by shaping the envelopes, not by listening; AJ's room is the check.
- The kick's tail reads 13 to 15 cents flat of its note on the estimator used (a 170 ms window on a decaying sine);
  within the target, but the estimator, not the kick, may be the reason.
- No sampled layer. If the room says the synthesized kit isn't there, the research's candidate is a CC0 kit, which
  would need its own licence check at the source and a `docs/SOUNDS.md` row before it ships.
