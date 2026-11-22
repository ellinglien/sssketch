import { describe, expect, it } from 'vitest'
import type { DiscoverCandidate } from './discoverCandidate'
import {
  EMPTY_HELD_STEMS,
  HELD_SLOT_COUNT,
  heldSlotForCode,
  heldSlotKinds,
  heldSlotLabel,
  normalizeHeldStems,
  rowHoldingStem,
  setHeldStem
} from './heldStems'

function candidate(stemCID: string): DiscoverCandidate {
  return {
    stemCID,
    jamCID: 'jam-a',
    riffCID: 'riff-a',
    presetName: 'tight kit',
    creatorUserName: 'mossy',
    slotKinds: ['bass'],
    drumSubRole: null,
    riffBpm: 120,
    traitValues: {},
    traitPercentiles: {},
    kindSources: {},
    riffCreationTime: null
  }
}

describe('heldStems: keys and slots', () => {
  it('maps keys 1 to 9 to slots, and 0 to none', () => {
    expect(heldSlotForCode('Digit1')).toBe(0)
    expect(heldSlotForCode('Digit9')).toBe(8)
    expect(heldSlotForCode('Digit0')).toBeNull()
    expect(heldSlotForCode('KeyT')).toBeNull()
    expect(heldSlotForCode('Numpad1')).toBeNull()
    expect(heldSlotForCode('Digit10')).toBeNull()
  })

  it('labels a slot with its key', () => {
    expect(Array.from({ length: HELD_SLOT_COUNT }, (_, i) => heldSlotLabel(i)).join('')).toBe(
      '123456789'
    )
  })

  it('slots 1 to 5 are drums, 6 to 9 are front', () => {
    for (let i = 0; i < 5; i++) expect(heldSlotKinds(i)).toEqual(['drums'])
    for (let i = 5; i < HELD_SLOT_COUNT; i++) expect(heldSlotKinds(i)).toEqual(['front'])
  })
})

describe('heldStems: assign and clear', () => {
  it('assigns into one slot, replacing, without touching the input', () => {
    const a = setHeldStem(EMPTY_HELD_STEMS, 2, candidate('s1'))
    expect(a[2]?.stemCID).toBe('s1')
    expect(EMPTY_HELD_STEMS[2]).toBeNull()
    const b = setHeldStem(a, 2, candidate('s2'))
    expect(b[2]?.stemCID).toBe('s2')
    expect(b.filter((s) => s !== null)).toHaveLength(1)
  })

  it('clears a slot, and ignores a slot that does not exist', () => {
    const a = setHeldStem(EMPTY_HELD_STEMS, 8, candidate('s1'))
    expect(setHeldStem(a, 8, null)).toEqual(EMPTY_HELD_STEMS)
    expect(setHeldStem(a, 9, candidate('s2'))).toBe(a)
    expect(setHeldStem(a, -1, candidate('s2'))).toBe(a)
  })
})

describe('heldStems: which row holds a stem', () => {
  it('finds the row playing the stem, or the one it waits to land on', () => {
    const rows = [
      { id: 'a', stemCID: 's1' },
      { id: 'b', stemCID: null, waitingStemCID: 's2' },
      { id: 'c', stemCID: null }
    ]
    expect(rowHoldingStem(rows, 's1')).toBe('a')
    expect(rowHoldingStem(rows, 's2')).toBe('b')
    expect(rowHoldingStem(rows, 's3')).toBeNull()
    expect(rowHoldingStem([], 's1')).toBeNull()
  })
})

describe('heldStems: the stored shape', () => {
  it('gives nine empty slots for anything that is not a list', () => {
    for (const bad of [undefined, null, 'x', 3, {}]) {
      expect(normalizeHeldStems(bad)).toEqual(EMPTY_HELD_STEMS)
    }
  })

  it('keeps good stems in place, pads a short list and cuts a long one', () => {
    const out = normalizeHeldStems([candidate('s1'), null, candidate('s3')])
    expect(out).toHaveLength(HELD_SLOT_COUNT)
    expect(out[0]).toEqual(candidate('s1'))
    expect(out[1]).toBeNull()
    expect(out[2]?.stemCID).toBe('s3')
    // a file saved with ten slots loses its tenth
    expect(normalizeHeldStems(Array.from({ length: 10 }, () => candidate('s')))).toHaveLength(
      HELD_SLOT_COUNT
    )
    expect(EMPTY_HELD_STEMS).toHaveLength(9)
  })

  it('empties a slot whose stem cannot be resolved or ranked', () => {
    const good = candidate('s1')
    expect(
      normalizeHeldStems([
        { ...good, stemCID: '' },
        { ...good, riffCID: 7 },
        { ...good, jamCID: undefined },
        { ...good, riffBpm: 'fast' },
        { ...good, riffBpm: 0 },
        'stem',
        [good]
      ])
    ).toEqual(EMPTY_HELD_STEMS)
  })

  it('fills the fields a row reads when a saved stem lacks them', () => {
    const out = normalizeHeldStems([
      { stemCID: 's1', jamCID: 'j', riffCID: 'r', riffBpm: 98, slotKinds: 'drums', traitValues: 4 }
    ])
    expect(out[0]).toEqual({
      stemCID: 's1',
      jamCID: 'j',
      riffCID: 'r',
      riffBpm: 98,
      presetName: '',
      creatorUserName: '',
      slotKinds: [],
      drumSubRole: null,
      traitValues: {},
      traitPercentiles: {},
      kindSources: {},
      riffCreationTime: null
    })
  })
})
