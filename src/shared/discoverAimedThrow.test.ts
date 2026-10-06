// The intensity arc's throw into the drop on the desktop (spec 2026-10-05-radio-intensity-arc-
// design 5.5): armed live a lap ahead, as a hook's exit throw is, ending on the drop's top or the
// gap's start, counting on the throw clock and drawing nothing.
import { describe, expect, it } from 'vitest'
import {
  armDiscoverAimedThrow,
  discoverAimedThrowRows,
  initialDiscoverThrowState,
  pickDiscoverAimedThrowRow
} from './discoverThrows'
import { throwDelaySec, throwTailSec } from './radioThrows'

const s0 = {
  ...initialDiscoverThrowState(),
  elapsedBars: 10,
  elapsedSec: 20,
  lastPos: 0.1,
  lastLoopBars: 4
}
const shape = { beats: 2, timing: 'quarter' as const, feedback: 0.5 }

describe('armDiscoverAimedThrow', () => {
  it('ends where it is aimed (the top, or a gap start before it) and counts on the clock', () => {
    const top = armDiscoverAimedThrow(s0, {
      slotId: 'l',
      shape,
      pos: 0.1,
      loopBars: 4,
      endInBars: 3.9,
      bpm: 120
    })!
    expect(top.armed).toMatchObject({ slotId: 'l', atBar: 3.5, beats: 2, aimed: true })
    expect(top.armed!.exit).toBeUndefined()
    expect(top.armed!.endBars - top.armed!.startBars).toBeCloseTo(0.5)
    expect(top.throws.busyUntil).toBeCloseTo(
      20 + 3.9 * 2 + throwTailSec(throwDelaySec(120, 'quarter'), 0.5)
    )
    expect(top.throws.barsSince).toBe(0)
    // a gap of 2 beats before the top: it ends half a bar earlier
    const gap = armDiscoverAimedThrow(s0, {
      slotId: 'l',
      shape,
      pos: 0.1,
      loopBars: 4,
      endInBars: 3.4,
      bpm: 120
    })!
    expect(gap.armed!.atBar).toBeCloseTo(3)
    expect(gap.armed!.startBars + 0.5).toBeCloseTo(10 + 3.4)
  })

  it('is null when it cannot: too late, past this lap, already armed, no tempo', () => {
    const o = { slotId: 'l', shape, pos: 0.1, loopBars: 4, endInBars: 3.9, bpm: 120 }
    expect(armDiscoverAimedThrow(s0, { ...o, pos: 3, endInBars: 1 })).toBeNull()
    expect(armDiscoverAimedThrow(s0, { ...o, endInBars: 5 })).toBeNull()
    expect(armDiscoverAimedThrow(s0, { ...o, bpm: 0 })).toBeNull()
    expect(armDiscoverAimedThrow(s0, { ...o, endInBars: Number.NaN })).toBeNull()
    const armed = armDiscoverAimedThrow(s0, o)!
    expect(armDiscoverAimedThrow(armed, o)).toBeNull()
  })
})

describe('discoverAimedThrowRows', () => {
  it('is the heard rows a throw may take: never drums or bass, never a silenced row', () => {
    const rows = [
      { slot: 'd', kinds: ['drums' as const], audible: true },
      { slot: 'b', kinds: ['bass' as const, 'warm' as const], audible: true },
      { slot: 'l', kinds: ['lead' as const], audible: true },
      { slot: 'w', kinds: ['warm' as const], audible: false },
      { slot: 'p', kinds: ['bright' as const], audible: true }
    ]
    expect(discoverAimedThrowRows(rows, [])).toEqual(['l', 'p'])
    expect(discoverAimedThrowRows(rows, ['p'])).toEqual(['l'])
  })
})

describe('pickDiscoverAimedThrowRow', () => {
  const rows = [
    { slot: 'd', kinds: ['drums' as const], audible: true },
    { slot: 'l', kinds: ['lead' as const], audible: true },
    { slot: 'p', kinds: ['bright' as const], audible: true }
  ]
  it('draws one of the rows a throw may take, evenly, with one number', () => {
    let n = 0
    const at = (v: number) => () => {
      n++
      return v
    }
    expect(pickDiscoverAimedThrowRow(rows, [], at(0))).toBe('l')
    expect(pickDiscoverAimedThrowRow(rows, [], at(0.99))).toBe('p')
    expect(n).toBe(2)
  })
  it('is null with none, drawing nothing', () => {
    let n = 0
    const r = (): number => {
      n++
      return 0
    }
    expect(pickDiscoverAimedThrowRow(rows, ['l', 'p'], r)).toBeNull()
    expect(n).toBe(0)
  })
})
