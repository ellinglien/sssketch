import { describe, expect, it } from 'vitest'
import { crossEmptyDropSlotCount } from './crossDropSlots'

describe('crossEmptyDropSlotCount', () => {
  it('starts with six empty slots and consumes them as stems are added', () => {
    expect(crossEmptyDropSlotCount(0, 20)).toBe(6)
    expect(crossEmptyDropSlotCount(1, 20)).toBe(5)
    expect(crossEmptyDropSlotCount(2, 20)).toBe(4)
    expect(crossEmptyDropSlotCount(3, 20)).toBe(3)
    expect(crossEmptyDropSlotCount(4, 20)).toBe(2)
    expect(crossEmptyDropSlotCount(5, 20)).toBe(1)
  })

  it('grows the tray to retain one trailing drop slot', () => {
    expect(crossEmptyDropSlotCount(6, 20)).toBe(1)
    expect(crossEmptyDropSlotCount(12, 20)).toBe(1)
  })

  it('never exceeds the remaining riff capacity', () => {
    expect(crossEmptyDropSlotCount(19, 20)).toBe(1)
    expect(crossEmptyDropSlotCount(20, 20)).toBe(0)
  })
})
