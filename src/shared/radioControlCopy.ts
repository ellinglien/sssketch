// What radio's and Discover's least obvious controls do, as their tooltips (the 2026-10-08 call,
// U6 and U7: Ben hovered turn and got "turn at the top", asked what like and keep do, and the
// source dial's "other" meant nothing to him). The guide (radioGuide.ts) uses the same sentences,
// so the tooltip and the guide can't drift apart.

export const RADIO_TURN_TOOLTIP = 'a turnaround at the next loop top'

/** Keep goes to the library, for every project; the two adds go into this one. */
export const RADIO_KEEP_TOOLTIP = 'save the rows playing now to your library'
export const RADIO_ADD_TO_SHELF_TOOLTIP = "into this project's shelf"
export const RADIO_ADD_TO_TIMELINE_TOOLTIP = "onto this project's timeline"

/** 👍 with radio on stars the stem and hooks it (radio keeps bringing it back); with radio off
 * it only stars it. */
export const RADIO_LIKE_TOOLTIP = 'star the sound as a favourite and hook it'
export const DISCOVER_LIKE_TOOLTIP = 'star the sound as a favourite'

/** "Other" is audio-in: stems recorded through a microphone or line in, rather than played on an
 * Endlesss instrument. In between, each roll leans that way. */
export const SOURCE_DIAL_TOOLTIP =
  'endlesss instruments to the left, audio-in recordings to the right'
