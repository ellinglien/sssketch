import { describe, expect, it } from 'vitest'
import { RADIO_BAR_STAGE_LEAD_BARS, radioBarLandingAim } from './radioBarAim'

describe('radioBarLandingAim', () => {
  it('keeps the bar radioChangeLandsAtBar named when the stage has time to get there', () => {
    expect(radioBarLandingAim(6, 5.03, 1, 8, RADIO_BAR_STAGE_LEAD_BARS)).toBe(6)
    expect(radioBarLandingAim(4, 1, 2, 8, 0.25)).toBe(4)
    // exactly the lead is still in time
    expect(radioBarLandingAim(6, 5.75, 1, 8, 0.25)).toBe(6)
  })

  it('a bar closer than the lead moves on to the next line of the grid', () => {
    expect(radioBarLandingAim(6, 5.9, 1, 8, 0.25)).toBe(7)
    expect(radioBarLandingAim(4, 3.95, 2, 8, 0.25)).toBe(6)
  })

  it('no line left in the lap: the loop top (undefined)', () => {
    expect(radioBarLandingAim(7, 6.9, 1, 8, 0.25)).toBeUndefined()
    expect(radioBarLandingAim(4, 3.9, 4, 8, 0.25)).toBeUndefined()
  })

  it('a zero lead is the bar as named (below the bar band nothing is re-aimed)', () => {
    expect(radioBarLandingAim(6, 5.99, 1, 8, 0)).toBe(6)
  })
})
