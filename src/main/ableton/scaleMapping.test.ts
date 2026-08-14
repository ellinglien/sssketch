import { describe, it, expect } from 'vitest'
import { parseKeyToAbletonScale } from './scaleMapping'
import { RIFF_LIBRARY_ROOT_NAMES as WAREHOUSE_ROOT_NAMES } from '@shared/riffLibraryTypes'

describe('parseKeyToAbletonScale', () => {
  it('parses a confirmed root + Minor (Aeolian) scale', () => {
    expect(parseKeyToAbletonScale('E Minor (Aeolian)')).toEqual({ root: 4, name: 1 })
  })

  it('parses a confirmed root + Major (Ionian) scale', () => {
    expect(parseKeyToAbletonScale('C Major (Ionian)')).toEqual({ root: 0, name: 0 })
  })

  it('maps every chromatic root name to its semitone offset from C', () => {
    const roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
    roots.forEach((rootName, expectedOffset) => {
      expect(parseKeyToAbletonScale(`${rootName} Minor (Aeolian)`)).toEqual({
        root: expectedOffset,
        name: 1
      })
    })
  })

  it('returns undefined for a scale name with no confirmed Ableton mapping', () => {
    expect(parseKeyToAbletonScale('D Dorian')).toBeUndefined()
    expect(parseKeyToAbletonScale('A Minor Pentatonic')).toBeUndefined()
  })

  it('returns undefined for an unrecognized root name', () => {
    expect(parseKeyToAbletonScale('H Major (Ionian)')).toBeUndefined()
  })

  it('returns undefined for a string with no space', () => {
    expect(parseKeyToAbletonScale('garbage')).toBeUndefined()
  })

  it('returns undefined for undefined input', () => {
    expect(parseKeyToAbletonScale(undefined)).toBeUndefined()
  })
})

describe('root name table stays in sync with @shared/riffLibraryTypes', () => {
  it('parses every root riffLibraryTypes produces', () => {
    WAREHOUSE_ROOT_NAMES.forEach((rootName, expectedOffset) => {
      expect(parseKeyToAbletonScale(`${rootName} Minor (Aeolian)`)?.root).toBe(expectedOffset)
    })
  })
})
