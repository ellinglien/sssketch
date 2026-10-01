import { describe, expect, it } from 'vitest'
import { ROW_PAN, panForSlots, stemPansForRifff } from './radioPan'
import type { SoundType } from './types'

const slot = (...kinds: string[]): { kinds: never[] } => ({ kinds: kinds as never[] })

// moved from ell.ing/radio src/radio/pan.test.ts (2026-10-01), unchanged but for the width cases
describe('panForSlots', () => {
  it('is subtle: 0.25', () => {
    expect(ROW_PAN).toBe(0.25)
  })

  it('keeps drums and bass in the middle', () => {
    expect(panForSlots([slot('drums'), slot('bass')])).toEqual([0, 0])
  })

  it('a slot carrying drums or bass among other kinds stays centred too', () => {
    expect(panForSlots([slot('lead', 'bass'), slot('warm', 'drums')])).toEqual([0, 0])
  })

  it('alternates the rest +, -, + in slot order, skipping the centred ones', () => {
    expect(
      panForSlots([slot('drums'), slot('bass'), slot('lead'), slot('warm'), slot('bright')])
    ).toEqual([0, 0, ROW_PAN, -ROW_PAN, ROW_PAN])
    expect(panForSlots([slot('lead'), slot('drums'), slot('warm')])).toEqual([ROW_PAN, 0, -ROW_PAN])
  })

  it('a slot with no kinds is not drums or bass: it is placed', () => {
    expect(panForSlots([slot()])).toEqual([ROW_PAN])
  })

  it('is empty for no slots', () => {
    expect(panForSlots([])).toEqual([])
  })

  it('honours a width (the sound settings), ROW_PAN when none is given', () => {
    expect(panForSlots([slot('lead'), slot('drums'), slot('warm')], 0.4)).toEqual([0.4, 0, -0.4])
    expect(panForSlots([slot('lead'), slot('warm')], 0)).toEqual([0, -0])
  })
})

describe('stemPansForRifff (the timeline: a rifff clip stems, by slot and SoundType)', () => {
  const stem = (slot: number, type: SoundType): { slot: number; type: SoundType } => ({
    slot,
    type
  })

  it('drums and bass are centred; the rest alternate +, - in slot order, keyed by slot', () => {
    const pans = stemPansForRifff([
      stem(1, 'drums'),
      stem(2, 'notes'),
      stem(3, 'bass'),
      stem(4, 'fx'),
      stem(5, 'sampler')
    ])
    expect([...pans.entries()]).toEqual([
      [1, 0],
      [2, ROW_PAN],
      [3, 0],
      [4, -ROW_PAN],
      [5, ROW_PAN]
    ])
  })

  it('goes by slot order, not the order the stems are given in', () => {
    const pans = stemPansForRifff([stem(4, 'fx'), stem(2, 'notes'), stem(1, 'drums')])
    expect(pans.get(2)).toBe(ROW_PAN)
    expect(pans.get(4)).toBe(-ROW_PAN)
    expect(pans.get(1)).toBe(0)
  })

  it('honours a width', () => {
    const pans = stemPansForRifff([stem(1, 'notes'), stem(2, 'extInst')], 0.1)
    expect(pans.get(1)).toBe(0.1)
    expect(pans.get(2)).toBe(-0.1)
  })

  it('is empty for no stems', () => {
    expect(stemPansForRifff([]).size).toBe(0)
  })
})
