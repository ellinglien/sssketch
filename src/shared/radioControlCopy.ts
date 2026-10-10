// What radio's and Discover's least obvious controls do, as their tooltips (the 2026-10-08 call,
// U6 and U7: Ben hovered turn and got "turn at the top", asked what like and keep do, and the
// source dial's "other" meant nothing to him; its ends are now "instruments" and "recorded"). The guide (radioGuide.ts) uses the same sentences,
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

/** The source dial's end labels, wherever it's drawn (Discover, radio's strip, the web radio):
 * Endlesss instrument stems to the left, audio-in stems (recorded through a microphone or line
 * in) to the right. They were "endlesss" and "other" until Elling renamed them (2026-10-09):
 * "other" meant nothing to Ben. */
export const SOURCE_DIAL_LEFT_LABEL = 'instruments'
export const SOURCE_DIAL_RIGHT_LABEL = 'recorded'

/** In between the ends, each roll leans that way. */
export const SOURCE_DIAL_TOOLTIP = `endlesss ${SOURCE_DIAL_LEFT_LABEL} to the left, ${SOURCE_DIAL_RIGHT_LABEL} audio-in to the right`
