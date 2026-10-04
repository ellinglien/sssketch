import { describe, expect, it } from 'vitest'
import {
  NO_RADIO_SLOT_FLAGS,
  REPLACE_SOON_FACTOR,
  forgetRadioSlotFlagOnChange,
  likeRadioSlot,
  pruneRadioSlotFlags,
  radioSlotFlagOf,
  radioSlotFlagWeightFactor,
  toggleRadioReplaceSoon,
  type RadioSlotFlags
} from './radioSlotFlags'

describe('radioSlotFlagWeightFactor', () => {
  it('hurries a tired layer; the hook is no longer a flag (radioHooks.ts)', () => {
    expect(radioSlotFlagWeightFactor('replace-soon')).toBe(REPLACE_SOON_FACTOR)
    expect(radioSlotFlagWeightFactor(null)).toBe(1)
  })
})

describe('likeRadioSlot', () => {
  it('stars an unstarred stem; holding, it clears change soon on the liked row', () => {
    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    const out = likeRadioSlot(tired, 'a', { starred: false, canHold: true })
    expect(out.starred).toBe(true)
    expect(radioSlotFlagOf(out.flags, 'a')).toBeNull()
    expect(likeRadioSlot(tired, 'a', { starred: false, canHold: false }).flags).toBe(tired)
  })

  it('un-stars a starred stem and leaves the flags alone', () => {
    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    const out = likeRadioSlot(tired, 'a', { starred: true, canHold: true })
    expect(out.starred).toBe(false)
    expect(out.flags).toBe(tired)
  })
})

describe('forgetRadioSlotFlagOnChange', () => {
  it('drops replace-soon on the layer the change landed on', () => {
    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(forgetRadioSlotFlagOnChange(tired, 'a'), 'a')).toBeNull()
  })

  it('leaves every other layer alone', () => {
    let flags = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    flags = toggleRadioReplaceSoon(flags, 'b')
    const after = forgetRadioSlotFlagOnChange(flags, 'a')
    expect(radioSlotFlagOf(after, 'b')).toBe('replace-soon')
  })

  it('returns the same object when there was nothing to forget', () => {
    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    expect(forgetRadioSlotFlagOnChange(tired, 'b')).toBe(tired)
  })
})

describe('pruneRadioSlotFlags', () => {
  it('drops a removed slot and keeps the live ones', () => {
    let flags = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    flags = toggleRadioReplaceSoon(flags, 'b')
    const pruned = pruneRadioSlotFlags(flags, new Set(['b']))
    expect(radioSlotFlagOf(pruned, 'a')).toBeNull()
    expect(radioSlotFlagOf(pruned, 'b')).toBe('replace-soon')
  })

  it('returns the same object when every flagged slot is still live', () => {
    const flags = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    expect(pruneRadioSlotFlags(flags, new Set(['a', 'b']))).toBe(flags)
  })
})

describe('toggleRadioReplaceSoon', () => {
  it('turns replace-soon on, and off again', () => {
    const on = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(on, 'a')).toBe('replace-soon')
    expect(radioSlotFlagOf(toggleRadioReplaceSoon(on, 'a'), 'a')).toBeNull()
  })

  it('can be on for any number of rows', () => {
    let flags = NO_RADIO_SLOT_FLAGS
    for (const id of ['a', 'b', 'c']) flags = toggleRadioReplaceSoon(flags, id)
    for (const id of ['a', 'b', 'c']) expect(radioSlotFlagOf(flags, id)).toBe('replace-soon')
  })

  it('never mutates what it is given', () => {
    const before: RadioSlotFlags = Object.freeze({ b: 'replace-soon' })
    const snapshot = structuredClone(before)
    toggleRadioReplaceSoon(before, 'c')
    toggleRadioReplaceSoon(before, 'a')
    toggleRadioReplaceSoon(before, 'b')
    expect(before).toEqual(snapshot)
  })

  it('turning it off leaves every other row exactly as it was', () => {
    const flags: RadioSlotFlags = { a: 'replace-soon', b: 'replace-soon', c: 'replace-soon' }
    expect(toggleRadioReplaceSoon(flags, 'a')).toEqual({ b: 'replace-soon', c: 'replace-soon' })
  })
})
