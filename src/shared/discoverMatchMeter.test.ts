// src/shared/discoverMatchMeter.test.ts
import { describe, expect, it } from 'vitest'
import {
  buildMatchMeter,
  DISCOVER_RECLASSIFY_ROLES,
  discoverRoleLabel,
  reclassifyKindSources,
  traitBarsFilled
} from './discoverMatchMeter'

describe('traitBarsFilled', () => {
  it('fills ceil(percentile * 5) of 5 steps', () => {
    expect(traitBarsFilled(0.83)).toBe(5)
    expect(traitBarsFilled(0.8)).toBe(4)
    expect(traitBarsFilled(0.61)).toBe(4)
    expect(traitBarsFilled(0.6)).toBe(3)
    expect(traitBarsFilled(0.01)).toBe(1)
    expect(traitBarsFilled(0)).toBe(0)
    expect(traitBarsFilled(1)).toBe(5)
  })

  it('clamps out-of-range values and treats unknown as 0', () => {
    expect(traitBarsFilled(1.4)).toBe(5)
    expect(traitBarsFilled(-0.2)).toBe(0)
    expect(traitBarsFilled(null)).toBe(0)
    expect(traitBarsFilled(undefined)).toBe(0)
    expect(traitBarsFilled(Number.NaN)).toBe(0)
  })
})

describe('buildMatchMeter', () => {
  it('one mask entry per mask kind that has a source, in slot order', () => {
    const entries = buildMatchMeter({
      kinds: ['drums', 'bass'],
      kindSources: { bass: 'guess', drums: 'tag' },
      traitPercentiles: {},
      barUsed: null
    })
    expect(entries).toEqual([
      {
        type: 'mask',
        kind: 'drums',
        label: 'drummy',
        source: 'tag',
        text: 'drummy: tag',
        tooltip: 'drummy: endlesss instrument tag · click to reclassify'
      },
      {
        type: 'mask',
        kind: 'bass',
        label: 'bassish',
        source: 'guess',
        text: 'bassish: guess',
        tooltip: "bassish: the overnight classifier's guess · click to reclassify"
      }
    ])
  })

  it('omits a mask kind with no source (another mask kind of the set admitted the stem)', () => {
    const entries = buildMatchMeter({
      kinds: ['drums', 'lead'],
      kindSources: { lead: 'confirmed' },
      traitPercentiles: {},
      barUsed: null
    })
    expect(entries.map((e) => e.text)).toEqual(['leadesque: confirmed'])
    expect(entries[0].tooltip).toBe('leadesque: confirmed by you · click to reclassify')
  })

  it('a trait entry shows 5-step bars from the library percentile', () => {
    const [entry] = buildMatchMeter({
      kinds: ['bright'],
      kindSources: {},
      traitPercentiles: { bright: 0.83 },
      barUsed: 0.6
    })
    expect(entry).toEqual({
      type: 'trait',
      kind: 'bright',
      label: 'sparkly',
      filled: 5,
      bars: '▮▮▮▮▮',
      text: 'sparkly ▮▮▮▮▮',
      tooltip: 'sparkly: brighter than 83% of your library'
    })
  })

  it('each trait gets its own phrasing', () => {
    const entries = buildMatchMeter({
      kinds: ['bassHeavy', 'rhythmic', 'warm'],
      kindSources: {},
      traitPercentiles: { bassHeavy: 0.5, rhythmic: 0.7, warm: 0.64 },
      barUsed: 0.6
    })
    expect(entries.map((e) => e.tooltip)).toEqual([
      'chonky: more bass-heavy than 50% of your library',
      'rhythmic: busier than 70% of your library',
      'buttery: warmer than 64% of your library'
    ])
    expect(entries.map((e) => (e.type === 'trait' ? e.bars : ''))).toEqual([
      '▮▮▮▯▯',
      '▮▮▮▮▯',
      '▮▮▮▮▯'
    ])
  })

  it('notes a relaxed bar when barUsed < 0.6', () => {
    const [entry] = buildMatchMeter({
      kinds: ['bright'],
      kindSources: {},
      traitPercentiles: { bright: 0.42 },
      barUsed: 0.4
    })
    expect(entry.tooltip).toBe(
      'sparkly: brighter than 42% of your library · bar relaxed to top 60% because few stems matched'
    )
  })

  it('a fully relaxed bar (0) says so', () => {
    const [entry] = buildMatchMeter({
      kinds: ['bright'],
      kindSources: {},
      traitPercentiles: { bright: 0.1 },
      barUsed: 0
    })
    expect(entry.tooltip).toBe(
      'sparkly: brighter than 10% of your library · bar relaxed to top 100% because few stems matched'
    )
  })

  it('an unanalysed stem shows empty bars and says so', () => {
    const [entry] = buildMatchMeter({
      kinds: ['rhythmic'],
      kindSources: {},
      traitPercentiles: {},
      barUsed: null
    })
    expect(entry).toMatchObject({
      filled: 0,
      bars: '▯▯▯▯▯',
      tooltip: 'rhythmic: not analysed yet'
    })
  })

  it('mask kinds come before trait kinds (normalized order)', () => {
    const entries = buildMatchMeter({
      kinds: ['bright', 'drums'],
      kindSources: { drums: 'tag' },
      traitPercentiles: { bright: 0.9 },
      barUsed: 0.6
    })
    expect(entries.map((e) => e.text)).toEqual(['drummy: tag', 'sparkly ▮▮▮▮▮'])
  })

  it('a reclassified role no slot kind covers shows as its own confirmed entry', () => {
    const entries = buildMatchMeter({
      kinds: ['drums', 'bright'],
      kindSources: {},
      traitPercentiles: { bright: 0.9 },
      barUsed: 0.6,
      reclassified: { role: 'textureFx', label: 'texture/fx' }
    })
    expect(entries[0]).toEqual({
      type: 'mask',
      kind: null,
      label: 'texture/fx',
      source: 'confirmed',
      text: 'texture/fx: confirmed',
      tooltip: 'texture/fx: confirmed by you · click to reclassify'
    })
    expect(entries).toHaveLength(2)
  })

  it('a reclassified role matching a slot kind adds no extra entry', () => {
    const entries = buildMatchMeter({
      kinds: ['drums'],
      kindSources: { drums: 'confirmed' },
      traitPercentiles: {},
      barUsed: null,
      reclassified: { role: 'drums', label: 'drummy' }
    })
    expect(entries.map((e) => e.text)).toEqual(['drummy: confirmed'])
  })
})

describe('reclassifyKindSources', () => {
  it("marks the slot's matching mask kind confirmed", () => {
    expect(reclassifyKindSources(['drums', 'bass'], 'bass')).toEqual({
      bass: 'confirmed'
    })
  })

  it('confirms the kind matching the new role', () => {
    expect(reclassifyKindSources(['drums'], 'drums')).toEqual({
      drums: 'confirmed'
    })
  })

  it('removes every mask source when the new role is none of the slot kinds', () => {
    expect(reclassifyKindSources(['drums', 'bright'], 'vocal')).toEqual({})
  })

  it('does not add a mask kind the slot does not request', () => {
    expect(reclassifyKindSources(['drums'], 'lead')).toEqual({})
  })
})

describe('reclassify roles', () => {
  it("lists Discover's mask kinds first, then the other Tidy Up roles", () => {
    expect(DISCOVER_RECLASSIFY_ROLES).toEqual([
      'drums',
      'bass',
      'lead',
      'backing',
      'aux',
      'textureFx',
      'fill',
      'vocal'
    ])
  })

  it('labels mask roles with their Discover label, others from the given table', () => {
    const labels = { textureFx: 'texture/fx' }
    expect(discoverRoleLabel('drums', labels)).toBe('drummy')
    expect(discoverRoleLabel('lead', labels)).toBe('leadesque')
    expect(discoverRoleLabel('textureFx', labels)).toBe('texture/fx')
    expect(discoverRoleLabel('vocal', labels)).toBe('vocal')
  })
})
