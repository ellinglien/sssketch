// The landing flicker's rule (spec 2026-10-03-sssketch-radio-view-design section 2):
// radioLanding.ts.
import { describe, expect, it } from 'vitest'
import {
  RADIO_LANDING_COALESCE_MS,
  shouldFlickerLanding,
  type RadioLandingSource
} from './radioLanding'

describe('shouldFlickerLanding', () => {
  it('flickers on the first landing', () => {
    expect(shouldFlickerLanding(null, 1000, 'radio')).toBe(true)
  })

  it('coalesces landings within 50 ms into one flicker, either side', () => {
    expect(shouldFlickerLanding(1000, 1000, 'radio')).toBe(false)
    expect(shouldFlickerLanding(1000, 1000 + RADIO_LANDING_COALESCE_MS - 1, 'arc')).toBe(false)
    expect(shouldFlickerLanding(1000, 1000 - 10, 'course')).toBe(false)
    expect(shouldFlickerLanding(1000, 1000 + RADIO_LANDING_COALESCE_MS, 'radio')).toBe(true)
  })

  it('flickers for everything radio-paced, never for a manual change landed at once', () => {
    const paced: RadioLandingSource[] = ['radio', 'course', 'arc', 'manual-wait', 'hook']
    for (const s of paced) expect(shouldFlickerLanding(null, 5000, s)).toBe(true)
    expect(shouldFlickerLanding(null, 5000, 'manual-now')).toBe(false)
    expect(shouldFlickerLanding(0, 5000, 'manual-now')).toBe(false)
  })

  it('ignores a time that is not a number', () => {
    expect(shouldFlickerLanding(null, Number.NaN, 'radio')).toBe(false)
  })
})
