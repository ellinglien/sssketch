import { isVerticalDominant } from './zoomMath'

/** Width of the fixed mixer strip at the right edge of Arrange. Mute, solo,
 * and every row gain share this one narrow vertical column. */
export const ARRANGEMENT_MIXER_RAIL_WIDTH = 30

/** Centers RowGainDial's 22px padded hit target inside the 30px rail. */
export const ARRANGEMENT_MIXER_CONTROL_INSET = 4

/** The first gain begins immediately below the channel's M/S pair. Later
 * stem gains remain at their row tops and naturally continue the column. */
export const ARRANGEMENT_FIRST_GAIN_TOP = 20

export type RailWheelGesture = { kind: 'zoom' } | { kind: 'scroll'; left: number; top: number }

/** What a wheel or trackpad gesture over the mixer rail does to the timeline. The rail sits
 * outside the scroller, so nothing scrolls natively under it: this hands each gesture back as
 * it would land over the timeline. A mostly vertical Cmd+wheel zooms (handleTimelineWheel); a
 * mostly horizontal Cmd+swipe pans, as the browser does over the timeline; Shift+wheel scrolls
 * sideways, as Chromium does when the system hasn't already turned the delta sideways. */
export function railWheelGesture(e: {
  deltaX: number
  deltaY: number
  metaKey: boolean
  shiftKey: boolean
}): RailWheelGesture {
  if (e.metaKey && isVerticalDominant(e.deltaX, e.deltaY)) return { kind: 'zoom' }
  if (e.shiftKey && e.deltaX === 0) return { kind: 'scroll', left: e.deltaY, top: 0 }
  return { kind: 'scroll', left: e.deltaX, top: e.deltaY }
}
