# Social cuts

The landing page's 30-second film (`../overdub-demo.mp4`), re-cut for feeds that autoplay with the sound off. Every
cut is the same real session in the studio, from the film's own script (`tools/demo-session.js`): Night Shift plays;
then a new song, and Tap a beat starts the first minute (the click, the ball in the top bar, a bar of count-in, two
passes tapped on the pads, each hit on the beat ruler and in the Drums lane as it lands, the hats layered over the
kick and snare); the Band builds chords and bass around the beat; the demo agent plays three takes over the band's
bass and you keep one; History. It is filmed again in Chromium for each cut, with the camera aimed at the part of the
studio that matters in each scene. The captions sit above the picture, large, in Archivo ExtraBold Italic, cream on
the room, so the first frame reads without sound. The soundtrack is the film's: every state the song passes through
rendered offline and played from where the transport was, and while the take records, each tap when its key went
down (and again on every later pass) with the click on the beats it sounded.

Made by `node tools/demo-cuts.js`. Rerun it after a visible change in the studio; `REUSE=1` recomposes from the last
filmed takes without filming again. All videos are H.264 (High) + AAC 128k at 48 kHz, yuv420p, BT.709, 30 fps, with
`+faststart`.

| file | size | length | where it goes |
|---|---|---|---|
| `overdub-vertical.mp4` | 1080x1920, 4.5 MB | 31.2 s | Instagram Reels, TikTok, YouTube Shorts, and X or LinkedIn posted from a phone. Captions sit between 170 and 640 px from the top and the picture between 664 and 1624 px, clear of the platforms' top tabs and bottom caption overlay; the lockup and address at the bottom can be covered. |
| `overdub-vertical-poster.jpg` | 1080x1920, 225 KB | still | The cover frame for Reels/TikTok (the first minute, both passes in the lane, with its caption). |
| `overdub-square.mp4` | 1080x1080, 3.8 MB | 31.2 s | X and LinkedIn feed posts, the Instagram grid and feed. |
| `overdub-square-poster.jpg` | 1080x1080, 178 KB | still | The thumbnail for the square cut (LinkedIn asks for one). |
| `overdub-loop.mp4` | 1080x1080, 0.7 MB | 4.0 s | A pinned post on X (and anywhere a short loop is wanted): the living Weave and "Play over each other.", then the tapped beat and the band built around it in the arranger ("Build a band around it."), then back to the Weave. It is two bars at 120 bpm, and its music is the beat and its band's own two-bar loop, turned to match the picture, so the picture and the music loop without a seam. X headers take still images only, so this is for the pinned post, not the header. |
| `overdub-loop-poster.jpg` | 1080x1080, 142 KB | still | The loop's first moment: the Weave and the line. |
| `overdub-square.gif` | 600x338, 2.4 MB | 31.1 s, 10 fps | A silent preview of the square cut beside the lockup, for READMEs, docs, email and anywhere video does not play. |

What each cut says, in order (the counts and the small lines are read from the session as it is filmed, not typed in):

1. *Play over each other.* A music studio for you and your agents.
2. *Tap a beat into the song.* A new song. Tap a beat starts the loop and the click. Then: Counting in. Recording
   onto Drums, pass 1. Recording onto Drums, pass 2 (with pass 1's readout from under the beat ruler: its
   hits and how late or early on average). Your beat is in: bars 1–2, 26 hits on Drums.
3. *Build a band around it.* Adds tracks only. Your notes stay as they are. Then: Band in: chords and bass around
   your 26 hits.
4. *Ask your agent to play over it.* In words. It works on what you select.
5. *The agent plays over you.* Three takes on the bass. You keep one.
6. *Every take is signed.* Warm is you, cool is the agent. (vertical adds: Undo the agent's change and yours stay.)
7. The end card: the living Weave, the lockup, "A studio for you and your agents.", overdubstudio.com.

Suggested post text, in the house voice (edit freely): "Overdub is a music studio for you and your agents. Tap a
beat into a song; the Band button builds chords and bass around it; your agent plays over it; every take is signed.
overdubstudio.com"
