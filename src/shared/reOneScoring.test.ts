import { describe, expect, it } from 'vitest'
import { scoreRifffForReOne, pickBestRifffForReOne } from './reOneScoring'
import type { Rifff, Stem } from './types'

function makeStem(overrides: Partial<Stem> = {}): Stem {
  return {
    slot: 1,
    author: 'someone',
    name: 'stem',
    type: 'fx',
    path: '/fake/stem.wav',
    durationSec: 8,
    barLength: 4,
    ...overrides
  }
}

function makeRifff(overrides: Partial<Rifff> = {}): Rifff {
  return {
    groupId: 'g1',
    name: 'a rifff',
    bpm: 120,
    barLength: 4,
    folderPath: '/fake',
    stems: [makeStem()],
    ...overrides
  }
}

describe('scoreRifffForReOne', () => {
  it('returns 0 for a rifff with no stems', () => {
    expect(scoreRifffForReOne(makeRifff({ stems: [] }))).toBe(0)
  })

  it('scores a longer loop (bigger barLength) higher, all else equal', () => {
    const short = makeRifff({ stems: [makeStem({ barLength: 2, durationSec: 4 })] })
    const long = makeRifff({ stems: [makeStem({ barLength: 8, durationSec: 4 })] })
    expect(scoreRifffForReOne(long)).toBeGreaterThan(scoreRifffForReOne(short))
  })

  it('scores more repeats (longer duration for the same loop length) higher', () => {
    const fewRepeats = makeRifff({ stems: [makeStem({ barLength: 4, durationSec: 8 })] })
    const manyRepeats = makeRifff({ stems: [makeStem({ barLength: 4, durationSec: 32 })] })
    expect(scoreRifffForReOne(manyRepeats)).toBeGreaterThan(scoreRifffForReOne(fewRepeats))
  })

  it('scores a rifff with a melodic (notes/bass) stem higher than an otherwise-identical one without', () => {
    const noMelody = makeRifff({ stems: [makeStem({ type: 'fx' }), makeStem({ type: 'drums' })] })
    const withBass = makeRifff({ stems: [makeStem({ type: 'bass' }), makeStem({ type: 'drums' })] })
    const withNotes = makeRifff({
      stems: [makeStem({ type: 'notes' }), makeStem({ type: 'drums' })]
    })
    expect(scoreRifffForReOne(withBass)).toBeGreaterThan(scoreRifffForReOne(noMelody))
    expect(scoreRifffForReOne(withNotes)).toBeGreaterThan(scoreRifffForReOne(noMelody))
  })

  it('scores a rifff with a drums stem higher than an otherwise-identical one without', () => {
    const noDrums = makeRifff({ stems: [makeStem({ type: 'fx' }), makeStem({ type: 'notes' })] })
    const withDrums = makeRifff({
      stems: [makeStem({ type: 'drums' }), makeStem({ type: 'notes' })]
    })
    expect(scoreRifffForReOne(withDrums)).toBeGreaterThan(scoreRifffForReOne(noDrums))
  })

  it('does not produce NaN or Infinity when bpm is 0', () => {
    const rifff = makeRifff({ bpm: 0, stems: [makeStem()] })
    const score = scoreRifffForReOne(rifff)
    expect(Number.isFinite(score)).toBe(true)
  })
})

describe('pickBestRifffForReOne', () => {
  it('returns null for an empty list', () => {
    expect(pickBestRifffForReOne([])).toBeNull()
  })

  it('picks the highest-scoring rifff’s groupId among several candidates', () => {
    const weak = makeRifff({
      groupId: 'weak',
      stems: [makeStem({ type: 'fx', barLength: 2, durationSec: 2 })]
    })
    const strong = makeRifff({
      groupId: 'strong',
      stems: [
        makeStem({ type: 'bass', barLength: 8, durationSec: 32 }),
        makeStem({ type: 'drums', barLength: 8, durationSec: 32 })
      ]
    })
    expect(pickBestRifffForReOne([weak, strong])).toBe('strong')
  })

  it('breaks ties by keeping the first highest-scoring rifff in the given order', () => {
    const a = makeRifff({ groupId: 'a' })
    const b = makeRifff({ groupId: 'b' })
    expect(pickBestRifffForReOne([a, b])).toBe('a')
  })
})
