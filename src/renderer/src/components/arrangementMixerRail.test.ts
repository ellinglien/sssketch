import { describe, expect, it } from 'vitest'
import { railWheelGesture } from './arrangementMixerRail'

const wheel = (
  deltaX: number,
  deltaY: number,
  mods: { meta?: boolean; shift?: boolean } = {}
): Parameters<typeof railWheelGesture>[0] => ({
  deltaX,
  deltaY,
  metaKey: mods.meta ?? false,
  shiftKey: mods.shift ?? false
})

describe('railWheelGesture', () => {
  it('scrolls the timeline by a plain wheel or swipe, both axes', () => {
    expect(railWheelGesture(wheel(0, 40))).toEqual({ kind: 'scroll', left: 0, top: 40 })
    expect(railWheelGesture(wheel(-12, 3))).toEqual({ kind: 'scroll', left: -12, top: 3 })
  })

  it('zooms on a mostly vertical cmd+wheel, like over the timeline', () => {
    expect(railWheelGesture(wheel(2, -30, { meta: true }))).toEqual({ kind: 'zoom' })
  })

  it('pans on a mostly horizontal cmd+swipe, like over the timeline', () => {
    expect(railWheelGesture(wheel(-25, 4, { meta: true }))).toEqual({
      kind: 'scroll',
      left: -25,
      top: 4
    })
  })

  it('turns shift+wheel into a sideways scroll, like over the timeline', () => {
    expect(railWheelGesture(wheel(0, 40, { shift: true }))).toEqual({
      kind: 'scroll',
      left: 40,
      top: 0
    })
  })

  it('leaves a shift+wheel the system already turned sideways as it is', () => {
    expect(railWheelGesture(wheel(40, 0, { shift: true }))).toEqual({
      kind: 'scroll',
      left: 40,
      top: 0
    })
  })
})
