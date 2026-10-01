import { describe, expect, it } from 'vitest'
import {
  HOOK_HOLD_FACTOR,
  NO_RADIO_SLOT_FLAGS,
  REPLACE_SOON_FACTOR,
  forgetRadioSlotFlagOnChange,
  likeRadioSlot,
  pruneRadioSlotFlags,
  radioHookSlotId,
  radioSlotFlagOf,
  radioSlotFlagWeightFactor,
  toggleRadioHook,
  toggleRadioReplaceSoon,
  type RadioSlotFlags
} from './radioSlotFlags'

describe('forgetRadioSlotFlagOnChange', () => {
  it('drops replace-soon on the layer the change landed on', () => {
    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(forgetRadioSlotFlagOnChange(tired, 'a'), 'a')).toBeNull()
  })

  it('keeps the hook through the change that turns it over', () => {
    // The hook is a statement about the channel, not about the stem that
    // happens to be in it.
    const hooked = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(forgetRadioSlotFlagOnChange(hooked, 'a'), 'a')).toBe('hook')
  })

  it('leaves every other layer alone', () => {
    let flags = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    flags = toggleRadioReplaceSoon(flags, 'b')
    const after = forgetRadioSlotFlagOnChange(flags, 'a')
    expect(radioSlotFlagOf(after, 'b')).toBe('replace-soon')
  })

  it('returns the same object when there was nothing to forget', () => {
    const hooked = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    expect(forgetRadioSlotFlagOnChange(hooked, 'b')).toBe(hooked)
  })
})

describe('pruneRadioSlotFlags', () => {
  it('drops a removed slot and keeps the live ones', () => {
    let flags = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    flags = toggleRadioReplaceSoon(flags, 'b')
    const pruned = pruneRadioSlotFlags(flags, new Set(['b']))
    expect(radioSlotFlagOf(pruned, 'a')).toBeNull()
    expect(radioSlotFlagOf(pruned, 'b')).toBe('replace-soon')
  })

  it('returns the same object when every flagged slot is still live', () => {
    const flags = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    expect(pruneRadioSlotFlags(flags, new Set(['a', 'b']))).toBe(flags)
  })

  it('frees the hook, so a re-added slot can take it', () => {
    const flags = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    const pruned = pruneRadioSlotFlags(flags, new Set<string>())
    expect(radioHookSlotId(pruned)).toBeNull()
  })
})

describe('radioSlotFlagWeightFactor', () => {
  it('holds the hook and hurries a tired layer, on opposite sides of 1', () => {
    expect(radioSlotFlagWeightFactor(null)).toBe(1)
    expect(radioSlotFlagWeightFactor('hook')).toBe(1 / HOOK_HOLD_FACTOR)
    expect(radioSlotFlagWeightFactor('replace-soon')).toBe(REPLACE_SOON_FACTOR)
    expect(radioSlotFlagWeightFactor('hook')).toBeLessThan(1)
    expect(radioSlotFlagWeightFactor('replace-soon')).toBeGreaterThan(1)
  })

  it('is deliberately NOT symmetrical', () => {
    // A divisor fights the unbounded (staleness + 1) growth and is
    // eventually overcome by it; a multiplier COMPOUNDS with that same
    // growth, and a layer flagged as tired is by definition already stale.
    // Equal numbers would not be equal claims.
    expect(REPLACE_SOON_FACTOR).toBeLessThan(HOOK_HOLD_FACTOR)
  })
})

describe('toggleRadioHook', () => {
  it('reports no hook when nothing is hooked', () => {
    expect(radioHookSlotId(NO_RADIO_SLOT_FLAGS)).toBeNull()
  })

  it('turns the hook on, and off again', () => {
    const on = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(on, 'a')).toBe('hook')
    expect(radioSlotFlagOf(toggleRadioHook(on, 'a'), 'a')).toBeNull()
  })

  it('moves the hook -- two centres is no centre', () => {
    const first = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    const second = toggleRadioHook(first, 'b')
    expect(radioSlotFlagOf(second, 'a')).toBeNull()
    expect(radioHookSlotId(second)).toBe('b')
  })

  it('replaces replace-soon on the same row', () => {
    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(toggleRadioHook(tired, 'a'), 'a')).toBe('hook')
  })

  it('leaves replace-soon on other rows alone', () => {
    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'b')
    expect(radioSlotFlagOf(toggleRadioHook(tired, 'a'), 'b')).toBe('replace-soon')
  })

  it('never mutates what it is given', () => {
    const before: RadioSlotFlags = Object.freeze({ a: 'hook', b: 'replace-soon' })
    const snapshot = structuredClone(before)
    toggleRadioHook(before, 'c')
    toggleRadioHook(before, 'a')
    toggleRadioHook(before, 'b')
    expect(before).toEqual(snapshot)
  })

  it('turning it off leaves every other row exactly as it was', () => {
    const flags: RadioSlotFlags = { a: 'hook', c: 'replace-soon', d: 'replace-soon' }
    expect(toggleRadioHook(flags, 'a')).toEqual({ c: 'replace-soon', d: 'replace-soon' })
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

  it('replaces the hook on the same row', () => {
    const hooked = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    const tired = toggleRadioReplaceSoon(hooked, 'a')
    expect(radioSlotFlagOf(tired, 'a')).toBe('replace-soon')
    expect(radioHookSlotId(tired)).toBeNull()
  })

  it('never costs the hook on another row', () => {
    const hooked = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioHookSlotId(toggleRadioReplaceSoon(hooked, 'b'))).toBe('a')
  })

  it('never mutates what it is given', () => {
    const before: RadioSlotFlags = Object.freeze({ a: 'hook', b: 'replace-soon' })
    const snapshot = structuredClone(before)
    toggleRadioReplaceSoon(before, 'c')
    toggleRadioReplaceSoon(before, 'a')
    toggleRadioReplaceSoon(before, 'b')
    expect(before).toEqual(snapshot)
  })

  it('turning it off leaves every other row exactly as it was', () => {
    const flags: RadioSlotFlags = { a: 'replace-soon', b: 'hook', c: 'replace-soon' }
    expect(toggleRadioReplaceSoon(flags, 'a')).toEqual({ b: 'hook', c: 'replace-soon' })
  })
})

describe('likeRadioSlot', () => {
  it('stars an unstarred stem and turns hold longer on', () => {
    const out = likeRadioSlot(NO_RADIO_SLOT_FLAGS, 'a', { starred: false, canHold: true })
    expect(out.starred).toBe(true)
    expect(radioSlotFlagOf(out.flags, 'a')).toBe('hook')
  })

  it('leaves an existing hold on (never toggles it off)', () => {
    const held = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    const out = likeRadioSlot(held, 'a', { starred: false, canHold: true })
    expect(out.starred).toBe(true)
    expect(out.flags).toBe(held)
  })

  it('takes the one hold from another row', () => {
    const held = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'b')
    const out = likeRadioSlot(held, 'a', { starred: false, canHold: true })
    expect(radioHookSlotId(out.flags)).toBe('a')
    expect(radioSlotFlagOf(out.flags, 'b')).toBeNull()
  })

  it('turns change next into hold on the liked row', () => {
    const tired = toggleRadioReplaceSoon(NO_RADIO_SLOT_FLAGS, 'a')
    const out = likeRadioSlot(tired, 'a', { starred: false, canHold: true })
    expect(radioSlotFlagOf(out.flags, 'a')).toBe('hook')
  })

  it('un-stars a starred stem and leaves the flags alone', () => {
    const held = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'a')
    const out = likeRadioSlot(held, 'a', { starred: true, canHold: true })
    expect(out.starred).toBe(false)
    expect(out.flags).toBe(held)
    const none = likeRadioSlot(NO_RADIO_SLOT_FLAGS, 'a', { starred: true, canHold: true })
    expect(none.flags).toBe(NO_RADIO_SLOT_FLAGS)
  })

  it('only stars when it cannot hold (radio off or padlocked)', () => {
    const held = toggleRadioHook(NO_RADIO_SLOT_FLAGS, 'b')
    const out = likeRadioSlot(held, 'a', { starred: false, canHold: false })
    expect(out.starred).toBe(true)
    expect(out.flags).toBe(held)
  })
})
