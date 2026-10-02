import { describe, expect, it } from 'vitest'
import {
  advanceRadioClock,
  createRadioClock,
  restartRadioInterval,
  type RadioClock
} from './radioSchedule'

/** Ticks `laps` whole laps of a `loopBars` loop, one tick a bar, and returns the wraps
 * (counted from 1) whose step said a turnaround lap starts there. Never true off a wrap. */
function turnaroundWraps(
  laps: number,
  loopBars: number,
  phraseBars: number,
  start: RadioClock = createRadioClock(1000, 0)
): number[] {
  let clock = start
  const out: number[] = []
  for (let lap = 1; lap <= laps; lap++) {
    for (let bar = 1; bar < loopBars; bar++) {
      const mid = advanceRadioClock(clock, bar, loopBars, loopBars, phraseBars)
      expect(mid.turnaroundLapStarts).toBe(false)
      clock = mid.clock
    }
    const wrap = advanceRadioClock(clock, 0, loopBars, loopBars, phraseBars)
    clock = wrap.clock
    if (wrap.turnaroundLapStarts) out.push(lap)
  }
  return out
}

describe('the turnaround lap count', () => {
  it("starts the last lap of each 16-bar phrase on a 4-bar loop, counted from radio's first loop top", () => {
    expect(turnaroundWraps(12, 4, 16)).toEqual([3, 7, 11])
  })

  it('runs with no phrase grid as 16 bars, where lapsSincePhrase stays at 0', () => {
    expect(turnaroundWraps(12, 4, 0)).toEqual([3, 7, 11])
    let clock = createRadioClock(1000, 0)
    for (let lap = 0; lap < 6; lap++) {
      clock = advanceRadioClock(clock, 2, 4, 4, 0).clock
      clock = advanceRadioClock(clock, 0, 4, 4, 0).clock
    }
    expect(clock.lapsSincePhrase).toBe(0)
    expect(clock.turnaroundLap).toBe(2) // six wraps: 1, 2, 3, 0, 1, 2
  })

  it('counts 32-bar phrases', () => {
    expect(turnaroundWraps(16, 4, 32)).toEqual([7, 15])
  })

  it('makes every wrap one on a loop of 16 bars or more', () => {
    expect(turnaroundWraps(3, 16, 16)).toEqual([1, 2, 3])
    expect(turnaroundWraps(3, 32, 32)).toEqual([1, 2, 3])
  })

  it("ends on the change grid's phrase wraps when the loop divides the phrase", () => {
    let clock = createRadioClock(1000, 0)
    const phraseWraps: number[] = []
    const turnaroundEnds: number[] = []
    for (let lap = 1; lap <= 12; lap++) {
      clock = advanceRadioClock(clock, 2, 4, 4, 16).clock
      const step = advanceRadioClock(clock, 0, 4, 4, 16)
      clock = step.clock
      if (clock.lapsSincePhrase === 0) phraseWraps.push(lap)
      if (step.turnaroundLapStarts) turnaroundEnds.push(lap + 1)
    }
    expect(phraseWraps).toEqual([4, 8, 12])
    expect(turnaroundEnds).toEqual([4, 8, 12])
  })

  it('a new interval keeps the count; a new clock starts it at 0', () => {
    const counted: RadioClock = { ...createRadioClock(8, 0), turnaroundLap: 2 }
    expect(restartRadioInterval(counted, 12, 1, 0).turnaroundLap).toBe(2)
    expect(createRadioClock(8, 2.5).turnaroundLap).toBe(0)
  })

  it('reads a clock written without the field as lap 0', () => {
    const old: RadioClock = { barsElapsed: 0, intervalBars: 1000, lastPos: 0, lapsSincePhrase: 0 }
    expect(turnaroundWraps(4, 4, 16, old)).toEqual([3])
  })

  it('folds a count left above a phrase that shrank back to the top', () => {
    // counted on a 2-bar loop (eight laps a phrase), and the loop grows to 8 bars (two laps)
    const counted: RadioClock = { ...createRadioClock(1000, 0), turnaroundLap: 5, lastPos: 4 }
    const step = advanceRadioClock(counted, 0, 8, 8, 16)
    expect(step.clock.turnaroundLap).toBe(0)
    expect(step.turnaroundLapStarts).toBe(false)
    const next = advanceRadioClock({ ...step.clock, lastPos: 4 }, 0, 8, 8, 16)
    expect(next.clock.turnaroundLap).toBe(1)
    expect(next.turnaroundLapStarts).toBe(true)
  })

  it('reports nothing on a tick it cannot read', () => {
    expect(advanceRadioClock(createRadioClock(8, 0), Number.NaN, 4).turnaroundLapStarts).toBe(false)
  })
})
