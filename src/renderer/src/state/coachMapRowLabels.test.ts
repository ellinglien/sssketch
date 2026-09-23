import { describe, expect, it } from 'vitest'
import type { CoachMapRow } from './coachMapRows'
import { coachMapRowLabels, mapRowsNeedCategorising } from './coachMapRowLabels'

function row(partial: Partial<CoachMapRow> & { channelId: string }): CoachMapRow {
  return {
    kind: 'stem',
    label: 'audio in',
    path: null,
    source: null,
    role: null,
    soundType: 'audioIn',
    clips: [],
    ...partial
  }
}

describe('coachMapRowLabels', () => {
  it('prefers the CONFIRMED role from the global table', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav', role: 'aux' })]
    expect(coachMapRowLabels(rows, { 'a.wav': 'drums' }).get('c0')).toBe('drums')
  })

  it('falls back to the climax role when nothing is confirmed', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav', role: 'bass' })]
    expect(coachMapRowLabels(rows, {}).get('c0')).toBe('bass')
  })

  it('falls back to the row own label when there is no role at all', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav', label: 'kick 02' })]
    expect(coachMapRowLabels(rows, {}).get('c0')).toBe('kick 02')
  })

  it('numbers rows that share a role, in ROW order', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav' }), row({ channelId: 'c1', path: 'b.wav' })]
    const labels = coachMapRowLabels(rows, { 'a.wav': 'drums', 'b.wav': 'drums' })
    expect(labels.get('c0')).toBe('drums 1')
    expect(labels.get('c1')).toBe('drums 2')
  })

  it('does not number a role only one row has', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav' }), row({ channelId: 'c1', path: 'b.wav' })]
    const labels = coachMapRowLabels(rows, { 'a.wav': 'drums', 'b.wav': 'bass' })
    expect(labels.get('c0')).toBe('drums')
    expect(labels.get('c1')).toBe('bass')
  })

  it('spells a role with ROLE_LABELS, not its raw value', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav' })]
    expect(coachMapRowLabels(rows, { 'a.wav': 'textureFx' }).get('c0')).toBe('texture/fx')
  })

  it('leaves a riser row its own name', () => {
    const rows = [row({ channelId: 'c9', kind: 'riser', label: 'riser 1', soundType: null })]
    expect(coachMapRowLabels(rows, {}).get('c9')).toBe('riser 1')
  })
})

describe('mapRowsNeedCategorising', () => {
  it('is true when a row with a stem has no role from anywhere', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav' })]
    expect(mapRowsNeedCategorising(rows, {})).toBe(true)
  })

  it('is false when every stem row has a role', () => {
    const rows = [row({ channelId: 'c0', path: 'a.wav', role: 'drums' })]
    expect(mapRowsNeedCategorising(rows, {})).toBe(false)
  })

  it('is false for a map of nothing but risers -- there is nothing to ask about', () => {
    const rows = [row({ channelId: 'c9', kind: 'riser', label: 'riser 1', soundType: null })]
    expect(mapRowsNeedCategorising(rows, {})).toBe(false)
  })
})
