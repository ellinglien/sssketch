import { describe, it, expect } from 'vitest'
import { assessTidyUpReadiness, unbussedStemPaths, type PlacedStemRef } from './tidyUpReadiness'

const drumsStem: PlacedStemRef = { stemKey: 'g1:0', path: '/lib/kick.wav' }
const bassStem: PlacedStemRef = { stemKey: 'g1:1', path: '/lib/bass.wav' }
const padStem: PlacedStemRef = { stemKey: 'g2:0', path: '/lib/pad.wav' }

describe('unbussedStemPaths', () => {
  it('is empty when every placed stem already has a bus', () => {
    expect(unbussedStemPaths([drumsStem, bassStem], { 'g1:0': 'drums', 'g1:1': 'bass' })).toEqual(
      []
    )
  })

  it('lists only the paths of stems with no bus', () => {
    expect(unbussedStemPaths([drumsStem, bassStem], { 'g1:0': 'drums' })).toEqual(['/lib/bass.wav'])
  })

  it('deduplicates -- the same file placed twice is one lookup, not two', () => {
    const copy: PlacedStemRef = { stemKey: 'g9:0', path: '/lib/bass.wav' }
    expect(unbussedStemPaths([bassStem, copy], {})).toEqual(['/lib/bass.wav'])
  })

  it('is empty for an empty timeline', () => {
    expect(unbussedStemPaths([], {})).toEqual([])
  })
})

describe('assessTidyUpReadiness', () => {
  it('nudges when nobody has said anything about anything', () => {
    const result = assessTidyUpReadiness([drumsStem, bassStem], {}, {})
    expect(result.needsNudge).toBe(true)
    expect(result.unansweredStemKeys).toEqual(['g1:0', 'g1:1'])
    expect(result.derivedBusOf).toEqual({})
  })

  it('does not nudge when every placed stem has a bus, and derives nothing', () => {
    const result = assessTidyUpReadiness(
      [drumsStem, bassStem],
      { 'g1:0': 'drums', 'g1:1': 'bass' },
      {}
    )
    expect(result.needsNudge).toBe(false)
    expect(result.unansweredStemKeys).toEqual([])
    expect(result.derivedBusOf).toEqual({})
  })

  it('does not nudge when every placed stem has a CONFIRMED ROLE and no bus at all', () => {
    // The reported bug: the auto-arrange role step writes roles globally and
    // never touches busOf, so this project was being called "untidied".
    const result = assessTidyUpReadiness(
      [drumsStem, bassStem],
      {},
      {
        '/lib/kick.wav': 'drums',
        '/lib/bass.wav': 'bass'
      }
    )
    expect(result.needsNudge).toBe(false)
    expect(result.unansweredStemKeys).toEqual([])
    expect(result.derivedBusOf).toEqual({ 'g1:0': 'drums', 'g1:1': 'bass' })
  })

  it('accepts a mix of the two -- some bussed, the rest role-confirmed', () => {
    const result = assessTidyUpReadiness(
      [drumsStem, bassStem],
      { 'g1:0': 'drums' },
      {
        '/lib/bass.wav': 'bass'
      }
    )
    expect(result.needsNudge).toBe(false)
    expect(result.derivedBusOf).toEqual({ 'g1:1': 'bass' })
  })

  it('still nudges when ONE placed stem is unanswered -- partial knowledge is not tidied', () => {
    // "any" would be the wrong rule: one confirmed role out of forty still
    // exports thirty-nine stems onto the aux pile, which is the dozens-of-
    // tracks problem the nudge exists to prevent.
    const result = assessTidyUpReadiness(
      [drumsStem, bassStem, padStem],
      { 'g1:0': 'drums' },
      {
        '/lib/bass.wav': 'bass'
      }
    )
    expect(result.needsNudge).toBe(true)
    expect(result.unansweredStemKeys).toEqual(['g2:0'])
    // The knowledge that DOES exist is still handed back, so an "export
    // anyway" is at least as good as it can be.
    expect(result.derivedBusOf).toEqual({ 'g1:1': 'bass' })
  })

  it('routes the three roles with no bus of their own onto aux', () => {
    const fx: PlacedStemRef = { stemKey: 'g3:0', path: '/lib/sweep.wav' }
    const hit: PlacedStemRef = { stemKey: 'g3:1', path: '/lib/hit.wav' }
    const voc: PlacedStemRef = { stemKey: 'g3:2', path: '/lib/voc.wav' }
    const result = assessTidyUpReadiness(
      [fx, hit, voc],
      {},
      {
        '/lib/sweep.wav': 'textureFx',
        '/lib/hit.wav': 'fill',
        '/lib/voc.wav': 'vocal'
      }
    )
    expect(result.needsNudge).toBe(false)
    expect(result.derivedBusOf).toEqual({ 'g3:0': 'aux', 'g3:1': 'aux', 'g3:2': 'aux' })
  })

  it('never overrides a real bus assignment with one derived from a role', () => {
    const result = assessTidyUpReadiness(
      [drumsStem],
      { 'g1:0': 'aux' },
      {
        '/lib/kick.wav': 'drums'
      }
    )
    expect(result.derivedBusOf).toEqual({})
  })

  it('derives a bus for every placement of the same file, not just the first', () => {
    const copy: PlacedStemRef = { stemKey: 'g9:0', path: '/lib/bass.wav' }
    const result = assessTidyUpReadiness([bassStem, copy], {}, { '/lib/bass.wav': 'bass' })
    expect(result.derivedBusOf).toEqual({ 'g1:1': 'bass', 'g9:0': 'bass' })
  })

  it('does not nudge an empty timeline -- there is nothing to tidy', () => {
    const result = assessTidyUpReadiness([], {}, {})
    expect(result.needsNudge).toBe(false)
    expect(result.unansweredStemKeys).toEqual([])
  })
})
