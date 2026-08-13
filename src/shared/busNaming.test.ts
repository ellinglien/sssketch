import { describe, it, expect } from 'vitest'
import { humanizeSoundType, summarizeSoundTypes, busGroupName } from './busNaming'

describe('humanizeSoundType', () => {
  it('inserts a space before each internal capital and lowercases the whole string', () => {
    expect(humanizeSoundType('extInst')).toBe('ext inst')
    expect(humanizeSoundType('audioIn')).toBe('audio in')
    expect(humanizeSoundType('drums')).toBe('drums')
  })
})

describe('summarizeSoundTypes', () => {
  it('lists types most-common-first', () => {
    expect(summarizeSoundTypes(['drums', 'drums', 'notes'])).toBe('drums, notes')
  })

  it('caps at the top 3 types', () => {
    const types = ['drums', 'notes', 'bass', 'fx', 'sampler'] as const
    const summary = summarizeSoundTypes([...types])
    expect(summary.split(', ')).toHaveLength(3)
  })

  it('returns an empty string for no types', () => {
    expect(summarizeSoundTypes([])).toBe('')
  })
})

describe('busGroupName', () => {
  it('appends a sound-type summary when it differs from the bare bus id', () => {
    expect(busGroupName('aux', [{ soundType: 'fx' }, { soundType: 'fx' }])).toBe('AUX — FX')
  })

  it('omits the summary when it would just repeat the bus id verbatim', () => {
    expect(busGroupName('drums', [{ soundType: 'drums' }, { soundType: 'drums' }])).toBe('DRUMS')
  })

  it('upper-cases the result', () => {
    expect(busGroupName('bass', [{ soundType: 'bass' }])).toBe('BASS')
  })
})
