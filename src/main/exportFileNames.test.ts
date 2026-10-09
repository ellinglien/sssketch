import { describe, expect, it } from 'vitest'
import { createStemExportFileNameAllocator, externalDawExportLocation } from './exportFileNames'

describe('createStemExportFileNameAllocator', () => {
  it('reserves generated suffixes against later real names', () => {
    const allocate = createStemExportFileNameAllocator()
    expect([allocate('riff', 'A'), allocate('riff', 'A'), allocate('riff', 'A-2')]).toEqual([
      'riff-A.wav',
      'riff-A-2.wav',
      'riff-A-2-2.wav'
    ])
  })

  it('treats case-only differences as collisions', () => {
    const allocate = createStemExportFileNameAllocator()
    expect([allocate('Riff', 'Kick'), allocate('riff', 'kick')]).toEqual([
      'Riff-Kick.wav',
      'riff-kick-2.wav'
    ])
  })

  it('shares one namespace between toolkit renders, dry stems, and reserved files', () => {
    const allocate = createStemExportFileNameAllocator()
    allocate.reserve('risers.wav')
    expect(allocate('riff', 'A', 'toolkit')).toBe('riff-A-toolkit.wav')
    expect(allocate('riff', 'A-toolkit')).toBe('riff-A-toolkit-2.wav')
    expect(allocate('RISERS', '')).not.toBe('risers.wav')
  })
})

describe('externalDawExportLocation', () => {
  it('isolates sketches in the same source directory', () => {
    expect(externalDawExportLocation('/music/a.sssketchproj', 'Ableton')).toEqual({
      projectName: 'a',
      outputDir: '/music/Ableton/a'
    })
    expect(externalDawExportLocation('/music/b.sssketchproj', 'Ableton')).toEqual({
      projectName: 'b',
      outputDir: '/music/Ableton/b'
    })
  })
})
