import { describe, expect, it } from 'vitest'
import { stemsToAvoid } from './discoverPickAvoid'

const slots = [
  { id: 'a', stemCID: 'x' },
  { id: 'b', stemCID: 'y' },
  { id: 'c', stemCID: null },
  { id: 'd', stemCID: 'x' }
]

describe('stemsToAvoid', () => {
  it("is the OTHER rows' stems for a manual roll", () => {
    expect([...stemsToAvoid(slots, 'b', { own: false })].sort()).toEqual(['x'])
  })

  it("adds the row's own stem for a radio re-pick", () => {
    expect([...stemsToAvoid(slots, 'b', { own: true })].sort()).toEqual(['x', 'y'])
  })

  it('skips rows with no stem, and a row with none of its own adds nothing', () => {
    expect([...stemsToAvoid(slots, 'c', { own: true })].sort()).toEqual(['x', 'y'])
  })

  it('still avoids a stem another row shares with this one', () => {
    expect([...stemsToAvoid(slots, 'a', { own: false })].sort()).toEqual(['x', 'y'])
  })
})
