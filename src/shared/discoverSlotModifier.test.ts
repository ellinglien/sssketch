import { describe, expect, it } from 'vitest'
import {
  DISCOVER_SLOT_MODIFIER_LABEL,
  DISCOVER_SLOT_MODIFIER_OPTIONS,
  slotRollOptions,
  toggleSlotModifier
} from './discoverSlotModifier'

describe('DISCOVER_SLOT_MODIFIER_OPTIONS', () => {
  it('lists the 4 modifiers in canonical order', () => {
    expect(DISCOVER_SLOT_MODIFIER_OPTIONS).toEqual(['preferFaves', 'endlesss', 'other', 'mine'])
  })

  it('has lowercase display labels', () => {
    expect(DISCOVER_SLOT_MODIFIER_LABEL).toEqual({
      preferFaves: 'prefer faves',
      endlesss: 'endlesss sounds',
      other: 'other sounds',
      mine: 'my sounds'
    })
  })
})

describe('toggleSlotModifier', () => {
  it('turns a modifier on, keeping canonical order', () => {
    expect(toggleSlotModifier(['mine'], 'endlesss')).toEqual(['endlesss', 'mine'])
  })

  it('turns a modifier off, including the last one', () => {
    expect(toggleSlotModifier(['other', 'mine'], 'other')).toEqual(['mine'])
    expect(toggleSlotModifier(['mine'], 'mine')).toEqual([])
  })

  it('dedupes', () => {
    expect(toggleSlotModifier(['mine', 'mine'], 'endlesss')).toEqual(['endlesss', 'mine'])
  })

  it('endlesss and other are independent (both may be on)', () => {
    expect(toggleSlotModifier(['endlesss'], 'other')).toEqual(['endlesss', 'other'])
  })
})

describe('slotRollOptions', () => {
  const withUser = { hasUsername: true }

  it('defaults to both sound sources, no ownership filter, no favourite preference', () => {
    expect(slotRollOptions([], withUser)).toEqual({
      soundSource: { endlesss: true, audioIn: true },
      onlyOwnStems: false,
      preferFavourites: false
    })
  })

  it("'endlesss' alone restricts to endlesss sounds", () => {
    expect(slotRollOptions(['endlesss'], withUser).soundSource).toEqual({
      endlesss: true,
      audioIn: false
    })
  })

  it("'other' alone restricts to non-endlesss sounds", () => {
    expect(slotRollOptions(['other'], withUser).soundSource).toEqual({
      endlesss: false,
      audioIn: true
    })
  })

  it('both sources selected means both', () => {
    expect(slotRollOptions(['endlesss', 'other'], withUser).soundSource).toEqual({
      endlesss: true,
      audioIn: true
    })
  })

  it("'mine' sets onlyOwnStems only with a username", () => {
    expect(slotRollOptions(['mine'], withUser).onlyOwnStems).toBe(true)
    expect(slotRollOptions(['mine'], { hasUsername: false }).onlyOwnStems).toBe(false)
  })

  it("'preferFaves' sets preferFavourites", () => {
    expect(slotRollOptions(['preferFaves'], withUser).preferFavourites).toBe(true)
  })
})
