import { describe, expect, it } from 'vitest'
import {
  instrumentMaskToSoundType,
  computeOwnerFraction,
  stemDownloadUrl,
  resolveKeyName,
  RIFF_LIBRARY_USERNAME
} from './riffLibraryTypes'

describe('instrumentMaskToSoundType', () => {
  it('maps the drum bit (2) to drums', () => {
    expect(instrumentMaskToSoundType(2)).toBe('drums')
  })

  it('maps the note bit (4) to notes', () => {
    expect(instrumentMaskToSoundType(4)).toBe('notes')
  })

  it('maps the bass bit (8) to bass', () => {
    expect(instrumentMaskToSoundType(8)).toBe('bass')
  })

  it('maps the mic bit (16) to audioIn', () => {
    expect(instrumentMaskToSoundType(16)).toBe('audioIn')
  })

  it('maps no bits set (0) to null', () => {
    expect(instrumentMaskToSoundType(0)).toBe(null)
  })

  it('prioritizes drum over note when both bits are set', () => {
    expect(instrumentMaskToSoundType(2 | 4)).toBe('drums')
  })

  it('prioritizes note over bass when both bits are set', () => {
    expect(instrumentMaskToSoundType(4 | 8)).toBe('notes')
  })

  it('prioritizes bass over mic when both bits are set', () => {
    expect(instrumentMaskToSoundType(8 | 16)).toBe('bass')
  })
})

describe('computeOwnerFraction', () => {
  it('is 1.0 when every creator matches', () => {
    expect(computeOwnerFraction(['elling', 'elling'], 'elling')).toBe(1)
  })

  it('is 0.0 when no creator matches', () => {
    expect(computeOwnerFraction(['ishaniii', 'mvdg'], 'elling')).toBe(0)
  })

  it('is the matching fraction for a mix', () => {
    expect(computeOwnerFraction(['elling', 'mvdg', 'elling', 'ishaniii'], 'elling')).toBe(0.5)
  })

  it('is 0 for an empty stem list, not NaN or a divide-by-zero error', () => {
    expect(computeOwnerFraction([], 'elling')).toBe(0)
  })

  it('matches RIFF_LIBRARY_USERNAME by default when no target is passed', () => {
    expect(computeOwnerFraction([RIFF_LIBRARY_USERNAME], undefined)).toBe(1)
  })
})

describe('stemDownloadUrl', () => {
  it('uses the endpoint directly as the host when FileBucket is empty', () => {
    expect(
      stemDownloadUrl(
        'endlesss-dev.fra1.digitaloceanspaces.com',
        '',
        'attachments/oggAudio/band19a7cb92f9/fa5413b0a70211ec93b025334e28e697'
      )
    ).toBe(
      'https://endlesss-dev.fra1.digitaloceanspaces.com/attachments/oggAudio/band19a7cb92f9/fa5413b0a70211ec93b025334e28e697'
    )
  })

  it('prefixes the endpoint with FileBucket as a subdomain when set', () => {
    expect(
      stemDownloadUrl(
        'fra1.digitaloceanspaces.com',
        'endlesss-dev',
        'attachments/oggAudio/banddfeb9ee860/4a7630cfce7211e9b0cf020000000000'
      )
    ).toBe(
      'https://endlesss-dev.fra1.digitaloceanspaces.com/attachments/oggAudio/banddfeb9ee860/4a7630cfce7211e9b0cf020000000000'
    )
  })
})

describe('resolveKeyName', () => {
  it('resolves a valid root+scale pair to a key name string', () => {
    // root=4 is E, scale=5 is Minor (Aeolian)
    expect(resolveKeyName(4, 5)).toBe('E Minor (Aeolian)')
  })

  it('resolves Major (Ionian) scale correctly', () => {
    // root=0 is C, scale=0 is Major (Ionian)
    expect(resolveKeyName(0, 0)).toBe('C Major (Ionian)')
  })

  it('returns undefined when root is null', () => {
    expect(resolveKeyName(null, 5)).toBeUndefined()
  })

  it('returns undefined when scale is null', () => {
    expect(resolveKeyName(4, null)).toBeUndefined()
  })

  it('returns undefined when both root and scale are null', () => {
    expect(resolveKeyName(null, null)).toBeUndefined()
  })

  it('returns undefined for an out-of-range root (negative)', () => {
    expect(resolveKeyName(-1, 5)).toBeUndefined()
  })

  it('returns undefined for an out-of-range root (too large)', () => {
    expect(resolveKeyName(12, 5)).toBeUndefined()
  })

  it('returns undefined for an out-of-range scale (negative)', () => {
    expect(resolveKeyName(4, -1)).toBeUndefined()
  })

  it('returns undefined for an out-of-range scale (too large)', () => {
    expect(resolveKeyName(4, 18)).toBeUndefined()
  })
})
