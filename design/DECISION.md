# The new look: Liner notes (decided 2026-10-01, 08:25)

AJ asked for a slick, modern update without the AI smell, above all "the boxes w/ the color on the left side for a few
pixels", keeping the direction he liked. Three directions were built as working mockups (`design/directions/*`, with
screenshots in each folder) after an audit of every surface against known AI-design tells
(`docs/research/AI-SMELLS.md`). Two critics scored them independently (one with AJ's eye, one as a working musician
who coaches beginners). Both picked **Liner notes**; so do I.

| | No AI smell | Keeps AJ's direction | Who played what / state at a glance | Phone | Distinctive | Risk |
|---|---|---|---|---|---|---|
| Tape and print | 6 / 6 | 8 / 7 | 8 / 6 | 5 / 5 | 8 / 9 | high |
| Instrument panel | 5 / 7 | 6 / 8 | 6 / 7 | 8 / 8 | 5 / 6 | low |
| **Liner notes** | **8 / 8** | **9 / 9** | **8 / 8** | **9 / 8** | 7 / 7 | medium |

**Liner notes** sets the studio like the back of a great record sleeve: a grid of hairline rules and whitespace
instead of boxes and cards, Archivo Expanded numerals and heads, and authorship as a **byline**: "you" in warm ink,
"Claude" in cool ink, on the clip's label line, on takes, in History. A word survives colour blindness and greyscale
where a stripe or a dot doesn't. The implementation plan is `design/directions/liner-notes/README.md`.

## Amendments (from the critics; they override the mockup)

1. **Sign people and agents only.** No "house" byline anywhere (it was noise on every demo clip); the house is the
   unsigned default.
2. **Cool ink stays off note fills.** Notes take the track's colour; authorship is the byline and the take preview,
   not a tint on 4 px notes. Nudge the slate track colour warmer so it can't read as agent.
3. **History's share is a labelled bar** (from Tape and print), not three hero numerals.
4. **Phones:** the track header shows M (mute) instead of the 01-06 numerals: stopping a part on a phone is AJ's ask.
5. **At most two heavy rule + display-italic heads per screen.** The rest are plain text heads.
6. **The clip-mute hint is findable** (not 11 px pencil in a corner): the first mute shows a toast with the key.

## Grafts

- From **Tape and print**: on the tap grid, each raw tap is a tick over the cell it snaps to ("your taps are the
  ticks; the cells are where they snap").
- From **Instrument panel**: its state lines, in the house voice: "Walk 2 is off: the bass sits out bars 5–8"
  (with Undo); "Tapping into the song: bars 5–6, looping, with the click"; "Pass 2 of your beat: each loop adds to the
  last", with beat lamps and a playhead column in the step grid; count-in and follow as their own keys; on phones a
  bottom tab bar (Song / Sketch / Agent / History).

## What changes in the rules

`CLAUDE.md` said authorship is "an edge or a badge, never a fill". It becomes: **authorship is a byline** (the
author's name in warm or cool ink, at the size of the text it signs); never a stripe, a fill or a dot alone.

The other two directions stay in `design/directions/` so the call is easy to revisit.
