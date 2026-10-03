// The phone's side of radio's roles (spec 2026-10-03-radio-anointed-stems-design section 5).
import { describe, expect, it } from 'vitest'
import type { CoachSlotSnapshot } from './coachClimax'
import { parseRemoteSlotAction, remoteStateFromSlots, type RemoteSlotRole } from './remoteState'

const slot = (id: string): CoachSlotSnapshot => ({
  id,
  kinds: ['drums'],
  stem: null,
  gain: 1,
  audible: true,
  rolling: false
})
const meta = {
  discoverOpen: true,
  playing: true,
  kept: 0,
  rolled: 0,
  lastKeptName: null,
  loopBars: 4
}

describe('roles on the phone', () => {
  it('the three new actions parse', () => {
    for (const a of ['hook', 'dig', 'back'] as const) expect(parseRemoteSlotAction(a)).toBe(a)
  })

  it('a row with a role carries it, words cut to the phone; no role, no field', () => {
    const roles = new Map<string, RemoteSlotRole>([
      ['a', { hook: 'away', dig: true, hookBarsAway: 15.6, words: 'hook · back in 16 bars · dig' }],
      ['b', { hook: null, dig: false, hookBarsAway: null, words: null }],
      ['c', { hook: 'in', dig: false, hookBarsAway: 8, words: 'hook' }]
    ])
    const s = remoteStateFromSlots([slot('a'), slot('b'), slot('c')], { ...meta, roles })
    expect(s.slots[0].role).toEqual({
      hook: 'away',
      dig: true,
      hookBarsAway: 16,
      words: 'hook · back in 16 bars'
    })
    expect('role' in s.slots[1]).toBe(false)
    expect(s.slots[2].role).toEqual({ hook: 'in', dig: false, hookBarsAway: null, words: 'hook' })
    expect('role' in remoteStateFromSlots([slot('a')], meta).slots[0]).toBe(false)
  })
})
