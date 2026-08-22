import { describe, it, expect } from 'vitest'
import {
  humanizeSoundType,
  summarizeSoundTypes,
  busGroupName,
  nextBusClipName,
  originalNameFromBusName
} from './busNaming'

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

describe('originalNameFromBusName', () => {
  it('strips an existing "{bus} {n} — " prefix', () => {
    expect(originalNameFromBusName('drums 1 — Highpass')).toBe('Highpass')
    expect(originalNameFromBusName('aux 12 — Audio In')).toBe('Audio In')
  })

  it('returns the name unchanged when it has no such prefix', () => {
    expect(originalNameFromBusName('Highpass')).toBe('Highpass')
    expect(originalNameFromBusName('my jam 150')).toBe('my jam 150')
  })

  it('only strips the LAST prefix, not a name that happens to contain " — " itself', () => {
    expect(originalNameFromBusName('drums 1 — Kick — Snare')).toBe('Kick — Snare')
  })
})

describe('nextBusClipName', () => {
  it('starts at 1 when no existing clip matches this bus, keeping the original name', () => {
    expect(nextBusClipName(['Audio In', 'my jam 150'], 'drums', 'Highpass')).toBe(
      'drums 1 — Highpass'
    )
  })

  it('picks one past the highest existing number for this bus', () => {
    expect(
      nextBusClipName(['drums 1 — a', 'drums 3 — b', 'drums 2 — c'], 'drums', 'Highpass')
    ).toBe('drums 4 — Highpass')
  })

  it('is case-insensitive and ignores whitespace when matching existing names', () => {
    expect(nextBusClipName(['DRUMS 1 — a', '  drums 2 — b  '], 'drums', 'Highpass')).toBe(
      'drums 3 — Highpass'
    )
  })

  it('ignores clips belonging to a different bus', () => {
    expect(nextBusClipName(['bass 1 — a', 'bass 2 — b'], 'drums', 'Highpass')).toBe(
      'drums 1 — Highpass'
    )
  })

  it('does not match a name that only shares the bus as a prefix', () => {
    expect(nextBusClipName(['drums extra 1'], 'drums', 'Highpass')).toBe('drums 1 — Highpass')
  })

  it('strips a prior bus-name prefix off the original name, so re-tidying never nests', () => {
    expect(nextBusClipName([], 'bass', 'drums 1 — Highpass')).toBe('bass 1 — Highpass')
  })
})
