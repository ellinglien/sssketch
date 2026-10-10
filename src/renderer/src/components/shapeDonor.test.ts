import { describe, expect, it } from 'vitest'
import { createShapeDraft } from '@shared/shape'
import type { Rifff } from '@shared/types'
import { shapeDonorMembers, shapeDonorRows, shapeDonorStemIsPresent } from './shapeDonor'

const donor: Rifff = {
  groupId: 'donor',
  name: 'donor riff',
  bpm: 120,
  barLength: 8,
  folderPath: '/donor',
  stems: [
    {
      slot: 1,
      author: 'a',
      name: 'one',
      type: 'drums',
      path: '/one.wav',
      durationSec: 4,
      barLength: 2
    },
    {
      slot: 2,
      author: 'b',
      name: 'two',
      type: 'bass',
      path: '/two.wav',
      durationSec: 4,
      barLength: 2
    }
  ]
}

describe('Shape donor tray', () => {
  it('keeps Mute underneath Solo and makes a zero-gain solo audible', () => {
    const rows = shapeDonorRows(donor, { 'donor:1': 0, 'donor:2': 0.5 })
    const muted = new Set(['donor:1'])

    expect(shapeDonorMembers(rows, muted, null)).toEqual([{ stem: rows[1].stem, gain: 0.5 }])
    expect(shapeDonorMembers(rows, muted, 'donor:1')).toEqual([{ stem: rows[0].stem, gain: 1 }])
    expect(shapeDonorMembers(rows, muted, null)).toEqual([{ stem: rows[1].stem, gain: 0.5 }])
  })

  it('starts silent and participates in the same solo pool as Shape lanes', () => {
    const rows = shapeDonorRows(donor, { 'donor:1': 0.25, 'donor:2': 0.5 })
    const allMuted = new Set(rows.map((row) => row.id))

    expect(shapeDonorMembers(rows, allMuted, null)).toEqual([])
    expect(shapeDonorMembers(rows, allMuted, 'shape-lane')).toEqual([])
    expect(shapeDonorMembers(rows, allMuted, rows[1].id)).toEqual([
      { stem: rows[1].stem, gain: 0.5 }
    ])
  })

  it('recognises a donor stem already present by its stable phase source', () => {
    const source: Rifff = {
      ...donor,
      groupId: 'source',
      stems: [{ ...donor.stems[0], path: '/prepared.wav', phaseSourcePath: '/one.wav' }]
    }
    const draft = createShapeDraft('project', source, {}, 'draft')
    const rows = shapeDonorRows(donor, {})

    expect(shapeDonorStemIsPresent(draft, rows[0])).toBe(true)
    expect(shapeDonorStemIsPresent(draft, rows[1])).toBe(false)
  })
})
