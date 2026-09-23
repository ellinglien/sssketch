import { describe, expect, it } from 'vitest'
import {
  coachSlotRole,
  isDiscoverSlotKind,
  kindsCoverSet,
  lockClimaxFromSlots,
  sanitiseLockedClimax,
  type CoachSlotSnapshot
} from './coachClimax'

const NOW = 1_700_000_000_000

function slot(overrides: Partial<CoachSlotSnapshot> = {}): CoachSlotSnapshot {
  return {
    id: 'slot-1',
    kinds: ['bass'],
    stem: {
      path: '/stems/bass.wav',
      name: 'low one',
      author: 'someone',
      type: 'bass',
      durationSec: 8,
      barLength: 4
    },
    gain: 1,
    audible: true,
    rolling: false,
    ...overrides
  }
}

describe('coachSlotRole', () => {
  it('reads the role off the kinds Discover itself tagged, mask kinds first', () => {
    expect(coachSlotRole(['drums'])).toBe('drums')
    expect(coachSlotRole(['bright', 'lead'])).toBe('lead')
    expect(coachSlotRole(['warm'])).toBe('aux')
  })

  it('falls back to aux rather than guessing for an empty set', () => {
    expect(coachSlotRole([])).toBe('aux')
  })
})

describe('lockClimaxFromSlots', () => {
  it('freezes stems, roles and gains', () => {
    const climax = lockClimaxFromSlots(
      [
        slot(),
        slot({
          id: 'slot-2',
          kinds: ['drums'],
          gain: 0.6,
          stem: { ...slot().stem!, path: '/stems/dr.wav', type: 'drums', barLength: 2 }
        })
      ],
      120,
      NOW
    )
    expect(climax?.bpm).toBe(120)
    expect(climax?.lockedAt).toBe(NOW)
    // The longest member, exactly like assembleDiscoverRifff's own rule.
    expect(climax?.barLength).toBe(4)
    expect(climax?.stems.map((s) => s.role)).toEqual(['bass', 'drums'])
    expect(climax?.stems.map((s) => s.gain)).toEqual([1, 0.6])
    expect(climax?.stems.map((s) => s.path)).toEqual(['/stems/bass.wav', '/stems/dr.wav'])
  })

  it('keeps a muted slot at gain zero rather than dropping it', () => {
    // Exactly what resolveDiscoverRifff already does when plunking into the
    // arranger: the stem stays, silent, instead of vanishing.
    const climax = lockClimaxFromSlots([slot({ audible: false, gain: 0.8 })], 120, NOW)
    expect(climax?.stems).toHaveLength(1)
    expect(climax?.stems[0].gain).toBe(0)
  })

  it('ignores a slot with nothing behind it yet', () => {
    const climax = lockClimaxFromSlots([slot(), slot({ id: 'slot-2', stem: null })], 120, NOW)
    expect(climax?.stems).toHaveLength(1)
  })

  it('returns null when there is nothing to lock', () => {
    expect(lockClimaxFromSlots([], 120, NOW)).toBeNull()
    expect(lockClimaxFromSlots([slot({ stem: null })], 120, NOW)).toBeNull()
  })

  it('normalizes each slot kind set, so two orderings lock identically', () => {
    const a = lockClimaxFromSlots([slot({ kinds: ['warm', 'lead'] })], 120, NOW)
    const b = lockClimaxFromSlots([slot({ kinds: ['lead', 'warm'] })], 120, NOW)
    expect(a?.stems[0].kinds).toEqual(['lead', 'warm'])
    expect(a).toEqual(b)
  })
})

describe('sanitiseLockedClimax', () => {
  it('round-trips a real locked climax through JSON', () => {
    const climax = lockClimaxFromSlots([slot()], 120, NOW)
    expect(sanitiseLockedClimax(JSON.parse(JSON.stringify(climax)))).toEqual(climax)
  })

  it('returns null for anything that is not one', () => {
    expect(sanitiseLockedClimax(null)).toBeNull()
    expect(sanitiseLockedClimax(undefined)).toBeNull()
    expect(sanitiseLockedClimax('nope')).toBeNull()
    expect(sanitiseLockedClimax({ bpm: 120, stems: 'lots' })).toBeNull()
  })

  it('drops a hand-edited stem it cannot read rather than throwing', () => {
    const repaired = sanitiseLockedClimax({
      bpm: 'fast',
      barLength: -3,
      lockedAt: NOW,
      stems: [
        {
          path: '/ok.wav',
          name: 'ok',
          author: 'a',
          type: 'bass',
          durationSec: 8,
          barLength: 4,
          kinds: ['bass', 'banana'],
          role: 'bass',
          gain: 3
        },
        { name: 'no path' }
      ]
    })
    expect(repaired?.bpm).toBe(120)
    expect(repaired?.barLength).toBe(4)
    expect(repaired?.stems).toHaveLength(1)
    expect(repaired?.stems[0].kinds).toEqual(['bass'])
    expect(repaired?.stems[0].gain).toBe(1)
  })

  it('returns null when every stem was unreadable', () => {
    expect(sanitiseLockedClimax({ bpm: 120, stems: [{ nope: true }] })).toBeNull()
  })
})

describe('isDiscoverSlotKind', () => {
  it('narrows a persisted string', () => {
    expect(isDiscoverSlotKind('bassHeavy')).toBe(true)
    expect(isDiscoverSlotKind('banana')).toBe(false)
    expect(isDiscoverSlotKind(7)).toBe(false)
  })
})

describe('kindsCoverSet', () => {
  it('is a superset test, not an overlap test', () => {
    expect(kindsCoverSet(['lead', 'bright'], ['lead'])).toBe(true)
    expect(kindsCoverSet(['lead'], ['lead', 'bright'])).toBe(false)
    expect(kindsCoverSet(['lead', 'warm'], ['lead', 'bright'])).toBe(false)
  })

  it('is false for an empty wanted set, never vacuously true', () => {
    expect(kindsCoverSet(['drums'], [])).toBe(false)
  })
})
