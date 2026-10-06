// Throws aimed into the drop (spec 2026-10-05-radio-intensity-arc-design 5.5): stepThrows'
// dropAt and stepDiscoverThrows' dropInBars.
import { describe, expect, it } from 'vitest'
import { initialThrowState, stepThrows, type ThrowState, type ThrowTick } from './radioThrows'
import { initialDiscoverThrowState, stepDiscoverThrows } from './discoverThrows'
import { hashText, seededRandom } from './seededRandom'

const BPM = 120
const BAR = 2 // seconds
const ROWS: ThrowTick['rows'] = [
  { slot: 'd', kinds: ['drums'], audible: false },
  { slot: 'l', kinds: ['lead'], audible: true },
  { slot: 'w', kinds: ['warm'], audible: true }
]
const tick = (now: number, o: Partial<ThrowTick> = {}): ThrowTick => ({
  now,
  bpm: BPM,
  nextBeat: Math.ceil((now + 0.25) / 0.5) * 0.5,
  held: false,
  leadingArmed: false,
  rows: ROWS,
  ...o
})

describe('throws and the drop', () => {
  it('a throw falling due in the breakdown waits for the drop and ends on its downbeat', () => {
    const due: ThrowState = { ...initialThrowState(), barsUntil: 0.5, lastNow: 0, barsSince: 30 }
    const dropAt = 12 * BAR
    let state = due
    let plan = null
    for (let now = 0; now < dropAt && plan === null; now += 0.25) {
      const r = stepThrows(state, tick(now, { dropAt }), seededRandom(`w${now}`))
      state = r.state
      plan = r.plan
    }
    expect(plan).not.toBeNull()
    expect(plan!.at + (plan!.beats * 60) / BPM).toBeCloseTo(dropAt, 9)
    expect(['l', 'w']).toContain(plan!.slot)
  })

  it("aims at the drop's gap when an armed turnaround's aim comes first", () => {
    const due: ThrowState = { ...initialThrowState(), barsUntil: 0, lastNow: 0, barsSince: 30 }
    const dropAt = 4 * BAR
    const gapAt = dropAt - 1
    const r = stepThrows(due, tick(dropAt - 1.75, { dropAt, changeAt: gapAt }), () => 0)
    expect(r.plan).not.toBeNull()
    expect(r.plan!.at + (r.plan!.beats * 60) / BPM).toBeCloseTo(gapAt, 9)
  })

  it('not due: nothing changes', () => {
    const early: ThrowState = { ...initialThrowState(), barsUntil: 20, lastNow: 0, barsSince: 2 }
    expect(stepThrows(early, tick(1, { dropAt: 4 * BAR }), () => 0).plan).toBeNull()
  })

  it('the desktop arms it on the loop, ending on the drop', () => {
    let s = {
      ...initialDiscoverThrowState(),
      throws: { ...initialThrowState(), barsUntil: 0, lastNow: 0, barsSince: 30 }
    }
    let armed = null
    for (let pos = 0; pos < 4 && armed === null; pos += 0.125) {
      const r = stepDiscoverThrows(
        s,
        {
          pos,
          loopBars: 4,
          bpm: BPM,
          playing: true,
          canArm: true,
          leadingArmed: false,
          dropInBars: 4 - pos,
          rows: ROWS,
          everyBars: [16, 32]
        },
        () => 0.3
      )
      s = r.state
      if (r.change === 'armed') armed = s.armed
    }
    expect(armed).not.toBeNull()
    expect(armed!.aimed).toBe(true)
    expect(armed!.atBar + armed!.beats / 4).toBeCloseTo(4, 9)
  })

  it('absent, every tick is what it was (a fingerprint of 20k seeded ticks)', () => {
    const r = seededRandom('throws-fp')
    let state = initialThrowState()
    const out: unknown[] = []
    let now = 0
    for (let i = 0; i < 20000; i++) {
      now += 0.1 + r() * 0.4
      const change = r() < 0.2 ? now + r() * 6 : null
      const step = stepThrows(
        state,
        tick(now, {
          held: r() < 0.05,
          leadingArmed: r() < 0.1,
          changeAt: change,
          silenced: r() < 0.2 ? ['l'] : []
        }),
        r
      )
      state = step.state
      out.push(step.plan)
    }
    expect(hashText(JSON.stringify([out, state]))).toBe(THROWS_BEFORE)
  })
})

/** Recorded from the unmodified radioThrows.ts (a9d68ef4) with this test's trace. */
const THROWS_BEFORE = '9207add6'
