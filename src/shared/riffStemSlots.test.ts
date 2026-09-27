import { describe, expect, it } from 'vitest'
import {
  LORE_STEM_COLUMN_COUNT,
  MAX_RIFFF_STEM_SLOTS,
  STEM_SLOT_COLUMNS,
  columnStemSlots,
  splitStemSlots,
  mergeStemSlots
} from './riffStemSlots'

describe('riffStemSlots', () => {
  it('names the two numbers apart', () => {
    expect(LORE_STEM_COLUMN_COUNT).toBe(8)
    expect(MAX_RIFFF_STEM_SLOTS).toBe(20)
  })

  it('STEM_SLOT_COLUMNS is exactly the eight LORE columns, in order', () => {
    expect(STEM_SLOT_COLUMNS).toEqual([
      'StemCID_1',
      'StemCID_2',
      'StemCID_3',
      'StemCID_4',
      'StemCID_5',
      'StemCID_6',
      'StemCID_7',
      'StemCID_8'
    ])
  })

  it('columnStemSlots reads non-null columns as 1-indexed slots and skips the nulls', () => {
    expect(
      columnStemSlots({ StemCID_1: 'a', StemCID_2: null, StemCID_3: 'c', StemCID_8: 'h' })
    ).toEqual([
      { slot: 1, stemCID: 'a' },
      { slot: 3, stemCID: 'c' },
      { slot: 8, stemCID: 'h' }
    ])
  })

  it('columnStemSlots on a row with no stems at all is empty, not an error', () => {
    expect(columnStemSlots({})).toEqual([])
  })

  it('splitStemSlots puts 1-8 in the columns and 9-20 in the extras', () => {
    const stems = Array.from({ length: 12 }, (_, i) => ({ slot: i + 1, stemCID: `s${i + 1}` }))
    const { columnStems, extraStems, dropped } = splitStemSlots(stems)
    expect(columnStems.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(extraStems.map((s) => s.slot)).toEqual([9, 10, 11, 12])
    expect(dropped).toEqual([])
  })

  it('splitStemSlots drops anything past the ceiling rather than writing it somewhere unreadable', () => {
    const stems = [
      { slot: 20, stemCID: 'twenty' },
      { slot: 21, stemCID: 'over' }
    ]
    const { extraStems, dropped } = splitStemSlots(stems)
    expect(extraStems.map((s) => s.slot)).toEqual([20])
    expect(dropped.map((s) => s.slot)).toEqual([21])
  })

  it('splitStemSlots drops a slot below 1 too', () => {
    const { columnStems, dropped } = splitStemSlots([{ slot: 0, stemCID: 'nope' }])
    expect(columnStems).toEqual([])
    expect(dropped.map((s) => s.stemCID)).toEqual(['nope'])
  })

  it('splitStemSlots keeps the given order within each half', () => {
    const { columnStems } = splitStemSlots([
      { slot: 3, stemCID: 'c' },
      { slot: 1, stemCID: 'a' }
    ])
    expect(columnStems.map((s) => s.stemCID)).toEqual(['c', 'a'])
  })

  it('mergeStemSlots returns one ascending slot list', () => {
    expect(
      mergeStemSlots(
        [
          { slot: 1, stemCID: 'a' },
          { slot: 2, stemCID: 'b' }
        ],
        [
          { slot: 10, stemCID: 'j' },
          { slot: 9, stemCID: 'i' }
        ]
      )
    ).toEqual([
      { slot: 1, stemCID: 'a' },
      { slot: 2, stemCID: 'b' },
      { slot: 9, stemCID: 'i' },
      { slot: 10, stemCID: 'j' }
    ])
  })

  it('mergeStemSlots with no extras is just the columns -- the external-LORE shape', () => {
    const columns = [{ slot: 1, stemCID: 'a' }]
    expect(mergeStemSlots(columns, [])).toEqual(columns)
  })

  it('mergeStemSlots ignores an extra that claims a column slot, so the columns always win', () => {
    expect(
      mergeStemSlots([{ slot: 1, stemCID: 'real' }], [{ slot: 1, stemCID: 'impostor' }])
    ).toEqual([{ slot: 1, stemCID: 'real' }])
  })
})
