import { describe, expect, it } from 'vitest'
import { reOneMarkerModel } from './reOneMarker'

describe('reOneMarkerModel', () => {
  it('places the new-one edge exactly on the picked subdivision', () => {
    expect(reOneMarkerModel(8, 16, true)).toEqual({
      leftPct: 50,
      label: 'new 1',
      labelSide: 'right',
      pending: true
    })
  })

  it('keeps the badge inside the view near the right edge', () => {
    expect(reOneMarkerModel(15, 16, true)?.labelSide).toBe('left')
  })

  it('shows a quieter one marker after the choice is committed', () => {
    expect(reOneMarkerModel(0, 16, false)?.label).toBe('1')
  })

  it('wraps legacy offsets and rejects an invalid grid', () => {
    expect(reOneMarkerModel(-1, 16, true)?.leftPct).toBe(93.75)
    expect(reOneMarkerModel(0, 0, true)).toBeNull()
  })
})
