import { describe, expect, it } from 'vitest'
import {
  radioApproachBarsLeft,
  radioApproachFor,
  radioApproachProgress,
  type RadioApproachWait
} from './radioApproach'
import { advanceRadioClock, radioBarsUntilChange, type RadioClock } from './radioSchedule'

describe('radioApproachBarsLeft', () => {
  it('rounds up, so "1 bar" always means it has not happened yet', () => {
    expect(radioApproachBarsLeft(0, 8)).toBe(8)
    expect(radioApproachBarsLeft(4, 8)).toBe(4)
    expect(radioApproachBarsLeft(7.5, 8)).toBe(1)
    expect(radioApproachBarsLeft(7.01, 8)).toBe(1)
  })

  it('never goes below zero, however far past the boundary the tick lands', () => {
    expect(radioApproachBarsLeft(8, 8)).toBe(0)
    expect(radioApproachBarsLeft(9.4, 8)).toBe(0)
  })

  it('answers null rather than a number it cannot stand behind', () => {
    expect(radioApproachBarsLeft(0, 0)).toBeNull()
    expect(radioApproachBarsLeft(0, -4)).toBeNull()
    expect(radioApproachBarsLeft(Number.NaN, 8)).toBeNull()
    expect(radioApproachBarsLeft(0, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('radioApproachProgress', () => {
  it('is the fraction of the wait already run', () => {
    expect(radioApproachProgress(0, 8)).toBe(0)
    expect(radioApproachProgress(2, 8)).toBe(0.25)
    expect(radioApproachProgress(8, 8)).toBe(1)
  })

  it('clamps rather than overshooting when a tick lands past the boundary', () => {
    expect(radioApproachProgress(12, 8)).toBe(1)
    expect(radioApproachProgress(-1, 8)).toBe(0)
  })

  it('is zero when there is no interval to be a fraction of', () => {
    expect(radioApproachProgress(4, 0)).toBe(0)
    expect(radioApproachProgress(Number.NaN, 8)).toBe(0)
  })
})

describe('radioApproachFor', () => {
  const wait: RadioApproachWait = { elapsedBars: 6, barsUntilChange: 2 }

  it('says nothing at all about a slot radio is not about to change', () => {
    expect(radioApproachFor({ slotId: 'c', armedSlotId: 'a', heldSlotId: 'b', wait })).toBeNull()
  })

  it('measures an armed slot against bars until the change lands', () => {
    expect(radioApproachFor({ slotId: 'a', armedSlotId: 'a', heldSlotId: null, wait })).toEqual({
      state: 'armed',
      progress: 0.75,
      barsLeft: 2
    })
  })

  it('measures a held slot against exactly the same quantity', () => {
    // THE WHOLE POINT. Same wait in, same numbers out -- only the state
    // differs, and the state is appearance. Until 2026-09-29 `held`
    // silently re-based onto the loop, so the rule on screen changed what
    // it meant at the instant it changed brightness ("yes generally
    // confusing").
    expect(radioApproachFor({ slotId: 'b', armedSlotId: null, heldSlotId: 'b', wait })).toEqual({
      state: 'held',
      progress: 0.75,
      barsLeft: 2
    })
  })

  it('lets held win, because a decided change outranks a coming one', () => {
    expect(radioApproachFor({ slotId: 'a', armedSlotId: 'a', heldSlotId: 'a', wait })).toEqual({
      state: 'held',
      progress: 0.75,
      barsLeft: 2
    })
  })

  it('is full only when the change is landing, never a bar before it', () => {
    const almost = radioApproachFor({
      slotId: 'a',
      armedSlotId: 'a',
      heldSlotId: null,
      wait: { elapsedBars: 15.9, barsUntilChange: 0.1 }
    })
    expect(almost?.barsLeft).toBe(1)
    expect(almost?.progress).toBeLessThan(1)
  })

  it('says nothing it cannot stand behind when the landing is not knowable', () => {
    expect(
      radioApproachFor({
        slotId: 'a',
        armedSlotId: 'a',
        heldSlotId: null,
        wait: { elapsedBars: 6, barsUntilChange: null }
      })
    ).toEqual({ state: 'armed', progress: 0, barsLeft: null })
  })

  it('clamps rather than overshooting when a tick lands past the boundary', () => {
    expect(
      radioApproachFor({
        slotId: 'a',
        armedSlotId: 'a',
        heldSlotId: null,
        wait: { elapsedBars: 9, barsUntilChange: -1 }
      })
    ).toEqual({ state: 'armed', progress: 1, barsLeft: 0 })
  })
})

describe('the countdown against the real clock', () => {
  // radioApproach is only as honest as the number it is handed, so these
  // run the WHOLE chain -- advanceRadioClock at 30Hz, radioBarsUntilChange
  // off the same tick, radioApproachFor off that -- and check the two
  // things Elling actually reported.
  const tick = 1 / 60 // bars per 30Hz tick at 120bpm
  const loopBars = 8
  const gridBars = 2

  function run(
    intervalBars: number,
    laps: number,
    onTick: (approach: NonNullable<ReturnType<typeof radioApproachFor>>, due: boolean) => void
  ): void {
    let clock: RadioClock = { barsElapsed: 0, intervalBars, lastPos: 0, lapsSincePhrase: 0 }
    let pos = 0
    for (let i = 0; i < Math.round((loopBars * laps) / tick); i += 1) {
      pos += tick
      if (pos >= loopBars) pos -= loopBars
      const step = advanceRadioClock(clock, pos, loopBars, gridBars, 0)
      clock = step.clock
      const approach = radioApproachFor({
        slotId: 'a',
        armedSlotId: 'a',
        heldSlotId: null,
        wait: {
          elapsedBars: clock.barsElapsed,
          barsUntilChange: radioBarsUntilChange(clock, pos, loopBars, gridBars, 0)
        }
      })
      if (approach !== null) onTick(approach, step.due)
      if (step.due) return
    }
    throw new Error('the change never came due')
  }

  it('counts down to its last bar, and then the change lands', () => {
    // The reported bug, in one assertion: "this one says 'this bar' but
    // continues to loop for a few more times". The old countdown ran the
    // INTERVAL down and then sat at the bottom of it for however many
    // bars the change grid still made it wait. This one is on its last
    // bar exactly once, on the bar the change lands in.
    const bottom: number[] = []
    let sawOne = false
    let last: number | null = null
    run(11, 4, (approach, due) => {
      if (due) return
      if (approach.barsLeft === 0) bottom.push(1)
      if (approach.barsLeft === 1) sawOne = true
      last = approach.barsLeft
    })
    expect(sawOne).toBe(true)
    // At the bottom for the ONE tick the landing boundary is under the
    // playhead, and the change lands on the next tick. The old countdown
    // spent whole laps down here.
    expect(bottom).toHaveLength(1)
    expect(last).toBe(0)
  })

  it('never runs backwards and never pins at full before the landing', () => {
    let previous = 0
    let fullBefore = 0
    run(11, 4, (approach, due) => {
      if (due) return
      expect(approach.progress).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = approach.progress
      if (approach.progress >= 1) fullBefore += 1
    })
    expect(fullBefore).toBe(0)
    // Full to within a tick of the landing, rather than a lap short of it
    // or a lap over it.
    expect(previous).toBeGreaterThan(0.99)
  })

  it('reopens the count when a boundary passes without the change landing', () => {
    // The overrun, which is the old bug in a new costume if it is got
    // wrong: a gesture is holding the change, so the clock runs on past
    // boundary after boundary. The count must recompute to the next real
    // boundary every time rather than freeze at zero.
    let clock: RadioClock = { barsElapsed: 20, intervalBars: 11, lastPos: 0, lapsSincePhrase: 0 }
    let pos = 0
    const seen: number[] = []
    for (let i = 0; i < Math.round(loopBars / tick); i += 1) {
      pos += tick
      if (pos >= loopBars) pos -= loopBars
      // Deliberately NOT restarted when it comes due: something else is
      // holding the change, exactly as radioLedChangeRef does.
      clock = advanceRadioClock(clock, pos, loopBars, gridBars, 0).clock
      const approach = radioApproachFor({
        slotId: 'a',
        armedSlotId: 'a',
        heldSlotId: null,
        wait: {
          elapsedBars: clock.barsElapsed,
          barsUntilChange: radioBarsUntilChange(clock, pos, loopBars, gridBars, 0)
        }
      })
      seen.push(approach?.barsLeft ?? -1)
    }
    // Four 2-bar boundaries go by in that lap, and the count is at the
    // bottom for exactly the one tick each of them is under the playhead
    // -- then it reopens to a fresh two bars. THE BUG IS A RUN, not a
    // zero: the old countdown pinned at the bottom and stayed there for
    // however many laps the wait had left.
    expect(seen.filter((bars) => bars === 0)).toHaveLength(4)
    expect(longestRunOfZero(seen)).toBe(1)
    expect(new Set(seen)).toEqual(new Set([0, 1, 2]))
  })
})

function longestRunOfZero(values: readonly number[]): number {
  let longest = 0
  let run = 0
  for (const value of values) {
    run = value === 0 ? run + 1 : 0
    if (run > longest) longest = run
  }
  return longest
}
