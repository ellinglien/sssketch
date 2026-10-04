// A hook's exit throw (spec 2026-10-03-radio-anointed-stems-design 2.5): it ENDS on its line, and
// counts on the regular throw clock without drawing anything.
import { describe, expect, it } from 'vitest'
import {
  initialThrowState,
  noteRadioExitThrow,
  radioThrowEndingAt,
  radioThrowEndingAtTop,
  stepThrows,
  throwDelaySec,
  throwTailSec,
  type ThrowTick
} from './radioThrows'
import { seededRandom } from './seededRandom'
import {
  THROW_RECALL_BARS,
  armDiscoverExitThrow,
  initialDiscoverThrowState,
  withdrawDiscoverExitThrow
} from './discoverThrows'

describe('the exit throw', () => {
  it('ends on its line', () => {
    const p = radioThrowEndingAt('d', { beats: 2, timing: 'quarter', feedback: 0.5 }, 40, 120)
    expect(p).toEqual({ slot: 'd', at: 39, beats: 2, timing: 'quarter', feedback: 0.5 })
    expect(p.at + (p.beats * 60) / 120).toBe(40)
    expect(radioThrowEndingAtTop({ beats: 1 }, 4)).toEqual({ atBar: 3.75, beats: 1 })
    expect(radioThrowEndingAtTop({ beats: 2 }, 0)).toBeNull()
  })

  it('holds the next regular throw off until its echoes are gone, and draws nothing', () => {
    const bpm = 120
    const tick = (now: number): ThrowTick => ({
      now,
      bpm,
      nextBeat: Math.ceil(now * 2 + 1e-9) / 2,
      held: false,
      leadingArmed: false,
      rows: [{ slot: 'l', kinds: ['lead'], audible: true }]
    })
    // a clock overdue for a throw
    const random = seededRandom('t')
    let s = stepThrows(initialThrowState(), tick(0), random).state
    s = { ...s, barsUntil: -10 }
    const tail = throwTailSec(throwDelaySec(bpm, 'quarter'), 0.6)
    let n = 0
    const counting = (): number => {
      n++
      return random()
    }
    const noted = noteRadioExitThrow(s, 10, tail)
    expect(n).toBe(0)
    expect(noted.barsUntil).toBe(s.barsUntil)
    expect(noted.barsSince).toBe(0)
    // nothing while the exit's echoes ring
    expect(stepThrows(noted, tick(9), counting).plan).toBeNull()
    expect(stepThrows(noted, tick(10 + tail - 0.6), counting).plan).toBeNull()
    // never earlier than a busier clock
    expect(noteRadioExitThrow({ ...s, busyUntil: 99 }, 10, tail).busyUntil).toBe(99)
  })
})

describe('the desktop exit throw (armDiscoverExitThrow)', () => {
  it('ends on the coming top, counts on the clock, and goes dry when it cannot', () => {
    const s0 = {
      ...initialDiscoverThrowState(),
      elapsedBars: 10,
      elapsedSec: 20,
      lastPos: 0.1,
      lastLoopBars: 4
    }
    const shape = { beats: 2, timing: 'quarter' as const, feedback: 0.5 }
    const s = armDiscoverExitThrow(s0, { slotId: 'd', shape, pos: 0.1, loopBars: 4, bpm: 120 })!
    expect(s.armed).toMatchObject({ slotId: 'd', atBar: 3.5, beats: 2, aimed: true, exit: true })
    expect(s.armed!.endBars - s.armed!.startBars).toBe(0.5)
    // ends on the top: 3.9 bars from 0.1, at 2 s a bar
    expect(s.throws.busyUntil).toBeCloseTo(
      20 + 3.9 * 2 + throwTailSec(throwDelaySec(120, 'quarter'), 0.5)
    )
    expect(s.throws.barsSince).toBe(0)
    // late in the lap, or on a 1-bar loop: dry
    expect(
      armDiscoverExitThrow(s0, { slotId: 'd', shape, pos: 3, loopBars: 4, bpm: 120 })
    ).toBeNull()
    expect(
      armDiscoverExitThrow(s0, { slotId: 'd', shape, pos: 0, loopBars: 1, bpm: 120 })
    ).toBeNull()
    // something armed already: dry
    expect(
      armDiscoverExitThrow(s, { slotId: 'd', shape, pos: 0.1, loopBars: 4, bpm: 120 })
    ).toBeNull()
  })
})

describe('the desktop exit throw withdrawn with its exit (withdrawDiscoverExitThrow)', () => {
  const s0 = {
    ...initialDiscoverThrowState(),
    elapsedBars: 10,
    elapsedSec: 20,
    lastPos: 0.1,
    lastLoopBars: 4
  }
  const shape = { beats: 2, timing: 'quarter' as const, feedback: 0.5 }
  const armed = armDiscoverExitThrow(s0, { slotId: 'd', shape, pos: 0.1, loopBars: 4, bpm: 120 })!

  it('takes the exit throw on its row back while it has not started', () => {
    const out = withdrawDiscoverExitThrow(armed, 'd')!
    expect(out.armed).toBeNull()
    expect(out.elapsedBars).toBe(armed.elapsedBars)
    // up to THROW_RECALL_BARS before it starts
    const late = { ...armed, elapsedBars: armed.armed!.startBars - THROW_RECALL_BARS }
    expect(withdrawDiscoverExitThrow(late, 'd')!.armed).toBeNull()
  })

  it('nothing on another row, a regular throw, none armed, or one under way', () => {
    expect(withdrawDiscoverExitThrow(armed, 'b')).toBeNull()
    expect(withdrawDiscoverExitThrow(s0, 'd')).toBeNull()
    const regular = { ...armed, armed: { ...armed.armed!, exit: undefined } }
    expect(withdrawDiscoverExitThrow(regular, 'd')).toBeNull()
    const underWay = { ...armed, elapsedBars: armed.armed!.startBars + 0.1 }
    expect(withdrawDiscoverExitThrow(underWay, 'd')).toBeNull()
  })
})
