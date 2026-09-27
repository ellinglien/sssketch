import { describe, expect, it } from 'vitest'
import { pickAdjacentCandidate } from './discoverAdjacentPick'

function c(stemCID: string): { stemCID: string } {
  return { stemCID }
}

describe('pickAdjacentCandidate', () => {
  it('draws from older first, then newer -- earlier before later', () => {
    const pick = pickAdjacentCandidate([c('o1'), c('o2')], [c('n1')], 'anchor', () => 0)
    expect(pick?.stemCID).toBe('o1')
  })

  it('reaches the newer end of the pool too', () => {
    // random -> 0.99 picks the last of three: older o1, o2, then newer n1.
    const pick = pickAdjacentCandidate([c('o1'), c('o2')], [c('n1')], 'anchor', () => 0.99)
    expect(pick?.stemCID).toBe('n1')
  })

  it('never hands back the stem already in the slot', () => {
    const pick = pickAdjacentCandidate([c('same')], [c('other')], 'same', () => 0)
    expect(pick?.stemCID).toBe('other')
  })

  it('returns null when the jam has nothing else nearby', () => {
    expect(pickAdjacentCandidate([], [], 'anchor', () => 0)).toBeNull()
    expect(pickAdjacentCandidate([c('same')], [], 'same', () => 0)).toBeNull()
  })

  it('cannot run off the end of the pool on a random of exactly 1', () => {
    const pick = pickAdjacentCandidate([c('o1')], [], 'anchor', () => 1)
    expect(pick?.stemCID).toBe('o1')
  })
})
