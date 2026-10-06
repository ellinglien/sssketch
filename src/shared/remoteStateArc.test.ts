// The phone's build and drop (spec 2026-10-05-radio-intensity-arc-design 6): remoteState.ts.
import { describe, expect, it } from 'vitest'
import {
  parseRemoteArcAction,
  remoteArcAnswer,
  remoteStateFromSlots,
  type RemoteArcView,
  type RemoteSlotRole,
  type RemoteStateMeta
} from './remoteState'
import { RADIO_ARC_REST_SHORT } from './radioIntensityArc'
import type { CoachSlotSnapshot } from './coachClimax'

const META: RemoteStateMeta = {
  discoverOpen: true,
  playing: true,
  kept: 0,
  rolled: 0,
  lastKeptName: null,
  loopBars: 4
}
const ARC: RemoteArcView = { phase: 'breakdown', waiting: null, canBuild: true, canDrop: true }

describe('the arc on the phone', () => {
  it('leaves only a real phase, and nothing without one', () => {
    expect(remoteStateFromSlots([], { ...META, arc: ARC }).arc).toEqual(ARC)
    expect(remoteStateFromSlots([], META).arc).toBeNull()
    const odd = { ...ARC, phase: 'peak', waiting: 'soon', canBuild: 1 } as unknown as RemoteArcView
    expect(remoteStateFromSlots([], { ...META, arc: odd }).arc).toBeNull()
    const loose = { ...ARC, waiting: 'soon', canBuild: 1 } as unknown as RemoteArcView
    expect(remoteStateFromSlots([], { ...META, arc: loose }).arc).toEqual({
      ...ARC,
      waiting: null,
      canBuild: false
    })
  })

  it('parses the action and answers it', () => {
    expect(parseRemoteArcAction('build')).toBe('build')
    expect(parseRemoteArcAction('drop')).toBe('drop')
    expect(parseRemoteArcAction('turn')).toBeNull()
    expect(parseRemoteArcAction(undefined)).toBeNull()
    expect(remoteArcAnswer(null, 'drop')).toBe('radio off')
    expect(remoteArcAnswer(undefined, 'build', false)).toBe('radio off')
    // radio runs with another density: not `radio off`
    expect(remoteArcAnswer(null, 'drop', true)).toBe('density not intensity')
    expect(remoteArcAnswer(ARC, 'drop', true)).toBe('dropping')
    expect(remoteArcAnswer(ARC, 'build')).toBe('building')
    expect(remoteArcAnswer(ARC, 'drop')).toBe('dropping')
    expect(remoteArcAnswer({ ...ARC, canDrop: false }, 'drop')).toBe('not now')
  })

  it('a row the arc rests carries its words alone (no hook, no dig): `rests`', () => {
    const slot: CoachSlotSnapshot = {
      id: 'a',
      kinds: ['drums'],
      stem: null,
      gain: 1,
      audible: false,
      rolling: false
    }
    const roles = new Map<string, RemoteSlotRole>([
      ['a', { hook: null, dig: false, hookBarsAway: null, words: RADIO_ARC_REST_SHORT }]
    ])
    expect(remoteStateFromSlots([slot], { ...META, roles }).slots[0].role).toEqual({
      hook: null,
      dig: false,
      hookBarsAway: null,
      words: 'rests'
    })
    // an empty word is still nothing
    const none = new Map<string, RemoteSlotRole>([
      ['a', { hook: null, dig: false, hookBarsAway: null, words: '' }]
    ])
    expect('role' in remoteStateFromSlots([slot], { ...META, roles: none }).slots[0]).toBe(false)
  })
})
