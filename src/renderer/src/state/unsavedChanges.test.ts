import { describe, expect, it } from 'vitest'
import { hasUnsavedChanges } from './unsavedChanges'
import type { AppState } from './store'
import type { Rifff } from '@shared/types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [
    { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 1, barLength: 8 }
  ]
}
const oneRifff: AppState['rifffs'] = { r1: rifff }
const noRifffs: AppState['rifffs'] = {}

describe('hasUnsavedChanges', () => {
  it('is false when there are no rifffs at all, regardless of the last-saved snapshot', () => {
    expect(hasUnsavedChanges(noRifffs, '{"rifffs":{}}', null)).toBe(false)
    expect(hasUnsavedChanges(noRifffs, '{"rifffs":{}}', '{"rifffs":{"stale":true}}')).toBe(false)
  })

  it('is false when the serialized state matches the last-saved snapshot', () => {
    expect(hasUnsavedChanges(oneRifff, '{"rifffs":{"r1":{}}}', '{"rifffs":{"r1":{}}}')).toBe(false)
  })

  it('is true when there are rifffs and the serialized state differs from the last-saved snapshot', () => {
    expect(hasUnsavedChanges(oneRifff, '{"rifffs":{"r1":{}}}', '{"rifffs":{}}')).toBe(true)
  })

  it('is true when there are rifffs and nothing has ever been saved (lastSavedJson is null)', () => {
    expect(hasUnsavedChanges(oneRifff, '{"rifffs":{"r1":{}}}', null)).toBe(true)
  })
})
