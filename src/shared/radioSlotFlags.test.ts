import { describe, expect, it } from 'vitest'
import {
  HOOK_HOLD_FACTOR,
  NO_RADIO_SLOT_FLAGS,
  REPLACE_SOON_FACTOR,
  cycleRadioSlotFlag,
  forgetRadioSlotFlagOnChange,
  pruneRadioSlotFlags,
  radioHookSlotId,
  radioSlotFlagOf,
  radioSlotFlagWeightFactor,
  type RadioSlotFlags
} from './radioSlotFlags'

/** Two presses -- the cycle reaches `replace-soon` first. */
function hook(flags: RadioSlotFlags, id: string): RadioSlotFlags {
  return cycleRadioSlotFlag(cycleRadioSlotFlag(flags, id), id)
}

describe('cycleRadioSlotFlag', () => {
  it('cycles one slot through none -> replace soon -> hook -> none', () => {
    const tired = cycleRadioSlotFlag(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(tired, 'a')).toBe('replace-soon')
    const hooked = cycleRadioSlotFlag(tired, 'a')
    expect(radioSlotFlagOf(hooked, 'a')).toBe('hook')
    const cleared = cycleRadioSlotFlag(hooked, 'a')
    expect(radioSlotFlagOf(cleared, 'a')).toBeNull()
  })

  it('never mutates what it is given', () => {
    const before = cycleRadioSlotFlag(NO_RADIO_SLOT_FLAGS, 'a')
    const after = cycleRadioSlotFlag(before, 'a')
    expect(radioSlotFlagOf(before, 'a')).toBe('replace-soon')
    expect(radioSlotFlagOf(after, 'a')).toBe('hook')
  })

  it('releases the old hook when a second layer is hooked -- two centres is no centre', () => {
    const first = hook(NO_RADIO_SLOT_FLAGS, 'a')
    const second = hook(first, 'b')
    expect(radioSlotFlagOf(second, 'a')).toBeNull()
    expect(radioSlotFlagOf(second, 'b')).toBe('hook')
    expect(radioHookSlotId(second)).toBe('b')
  })

  it('does NOT release the old replace-soon when a second layer is flagged', () => {
    // Being tired of three layers at once is an ordinary thing to be.
    let flags = NO_RADIO_SLOT_FLAGS
    for (const id of ['a', 'b', 'c']) flags = cycleRadioSlotFlag(flags, id)
    expect(radioSlotFlagOf(flags, 'a')).toBe('replace-soon')
    expect(radioSlotFlagOf(flags, 'b')).toBe('replace-soon')
    expect(radioSlotFlagOf(flags, 'c')).toBe('replace-soon')
  })

  it('does not release a hook on the way past replace-soon', () => {
    // The reason the cycle reaches replace-soon FIRST: flagging b as tired
    // must not quietly cost the hook that is on a.
    const hooked = hook(NO_RADIO_SLOT_FLAGS, 'a')
    const tired = cycleRadioSlotFlag(hooked, 'b')
    expect(radioSlotFlagOf(tired, 'a')).toBe('hook')
    expect(radioSlotFlagOf(tired, 'b')).toBe('replace-soon')
    expect(radioHookSlotId(tired)).toBe('a')
  })

  it('reports no hook when nothing is hooked', () => {
    expect(radioHookSlotId(NO_RADIO_SLOT_FLAGS)).toBeNull()
    expect(radioHookSlotId(cycleRadioSlotFlag(NO_RADIO_SLOT_FLAGS, 'a'))).toBeNull()
  })
})

describe('forgetRadioSlotFlagOnChange', () => {
  it('drops replace-soon on the layer the change landed on', () => {
    const tired = cycleRadioSlotFlag(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(forgetRadioSlotFlagOnChange(tired, 'a'), 'a')).toBeNull()
  })

  it('keeps the hook through the change that turns it over', () => {
    // The hook is a statement about the channel, not about the stem that
    // happens to be in it.
    const hooked = hook(NO_RADIO_SLOT_FLAGS, 'a')
    expect(radioSlotFlagOf(forgetRadioSlotFlagOnChange(hooked, 'a'), 'a')).toBe('hook')
  })

  it('leaves every other layer alone', () => {
    let flags = cycleRadioSlotFlag(NO_RADIO_SLOT_FLAGS, 'a')
    flags = cycleRadioSlotFlag(flags, 'b')
    const after = forgetRadioSlotFlagOnChange(flags, 'a')
    expect(radioSlotFlagOf(after, 'b')).toBe('replace-soon')
  })

  it('returns the same object when there was nothing to forget', () => {
    const hooked = hook(NO_RADIO_SLOT_FLAGS, 'a')
    expect(forgetRadioSlotFlagOnChange(hooked, 'b')).toBe(hooked)
  })
})

describe('pruneRadioSlotFlags', () => {
  it('drops a removed slot and keeps the live ones', () => {
    let flags = hook(NO_RADIO_SLOT_FLAGS, 'a')
    flags = cycleRadioSlotFlag(flags, 'b')
    const pruned = pruneRadioSlotFlags(flags, new Set(['b']))
    expect(radioSlotFlagOf(pruned, 'a')).toBeNull()
    expect(radioSlotFlagOf(pruned, 'b')).toBe('replace-soon')
  })

  it('returns the same object when every flagged slot is still live', () => {
    const flags = hook(NO_RADIO_SLOT_FLAGS, 'a')
    expect(pruneRadioSlotFlags(flags, new Set(['a', 'b']))).toBe(flags)
  })

  it('frees the hook, so a re-added slot can take it', () => {
    const flags = hook(NO_RADIO_SLOT_FLAGS, 'a')
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
