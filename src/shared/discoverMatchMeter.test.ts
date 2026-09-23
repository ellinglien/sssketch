// src/shared/discoverMatchMeter.test.ts
import { describe, expect, it } from 'vitest'
import {
  buildMatchMeter,
  DISCOVER_RECLASSIFY_ROLES,
  discoverRoleLabel,
  reclassifyKindSources,
  traitBarsFilled
} from './discoverMatchMeter'
import {
  DISCOVER_MASK_SLOT_KINDS,
  DISCOVER_TRAIT_SLOT_KINDS,
  type DiscoverKindSource,
  type DiscoverMaskKind,
  type DiscoverTraitKind
} from './discoverSlotKind'

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
        tooltip: 'endlesss instrument tag'
      },
      {
        type: 'mask',
        kind: 'bass',
        label: 'bassish',
        source: 'guess',
        text: 'bassish: guess',
        tooltip: "classifier's guess"
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
    expect(entries[0].tooltip).toBe('confirmed by you')
  })

  it('a trait entry shows 5-step bars from the library percentile', () => {
    const [entry] = buildMatchMeter({
      kinds: ['bright'],
      kindSources: {},
      traitPercentiles: { bright: 0.83 },
      barUsed: 0.6,
      barRequested: 0.6
    })
    expect(entry).toEqual({
      type: 'trait',
      kind: 'bright',
      label: 'sparkly',
      filled: 5,
      bars: '▮▮▮▮▮',
      text: 'sparkly ▮▮▮▮▮',
      tooltip: 'sparkly: 83%'
    })
  })

  it('each trait reads back its own percentile', () => {
    const entries = buildMatchMeter({
      kinds: ['bassHeavy', 'rhythmic', 'warm'],
      kindSources: {},
      traitPercentiles: { bassHeavy: 0.5, rhythmic: 0.7, warm: 0.64 },
      barUsed: 0.6,
      barRequested: 0.6
    })
    expect(entries.map((e) => e.tooltip)).toEqual(['chonky: 50%', 'rhythmic: 70%', 'buttery: 64%'])
    expect(entries.map((e) => (e.type === 'trait' ? e.bars : ''))).toEqual([
      '▮▮▮▯▯',
      '▮▮▮▮▯',
      '▮▮▮▮▯'
    ])
  })

  it('notes a relaxed bar when barUsed < the requested bar', () => {
    const [entry] = buildMatchMeter({
      kinds: ['bright'],
      kindSources: {},
      traitPercentiles: { bright: 0.42 },
      barUsed: 0.4,
      barRequested: 0.6
    })
    expect(entry.tooltip).toBe('sparkly: 42% · relaxed')
  })

  it('a fully relaxed bar (0) says so', () => {
    const [entry] = buildMatchMeter({
      kinds: ['bright'],
      kindSources: {},
      traitPercentiles: { bright: 0.1 },
      barUsed: 0,
      barRequested: 0.6
    })
    expect(entry.tooltip).toBe('sparkly: 10% · relaxed')
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
      tooltip: 'not analysed yet'
    })
  })

  it('mask kinds come before trait kinds (normalized order)', () => {
    const entries = buildMatchMeter({
      kinds: ['bright', 'drums'],
      kindSources: { drums: 'tag' },
      traitPercentiles: { bright: 0.9 },
      barUsed: 0.6,
      barRequested: 0.6
    })
    expect(entries.map((e) => e.text)).toEqual(['drummy: tag', 'sparkly ▮▮▮▮▮'])
  })

  it('a reclassified role no slot kind covers shows as its own confirmed entry', () => {
    const entries = buildMatchMeter({
      kinds: ['drums', 'bright'],
      kindSources: {},
      traitPercentiles: { bright: 0.9 },
      barUsed: 0.6,
      barRequested: 0.6,
      reclassified: { role: 'textureFx', label: 'texture/fx' }
    })
    expect(entries[0]).toEqual({
      type: 'mask',
      kind: null,
      label: 'texture/fx',
      source: 'confirmed',
      text: 'texture/fx: confirmed',
      tooltip: 'confirmed by you'
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

describe('buildMatchMeter relaxed marker follows the requested bar', () => {
  it('no marker when the pick met a strict requested bar', () => {
    const [entry] = buildMatchMeter({
      kinds: ['bright'],
      kindSources: {},
      traitPercentiles: { bright: 0.95 },
      barUsed: 0.9,
      barRequested: 0.9
    })
    expect(entry.tooltip).toBe('sparkly: 95%')
  })

  it('marks relaxation from a strict requested bar', () => {
    const [entry] = buildMatchMeter({
      kinds: ['bright'],
      kindSources: {},
      traitPercentiles: { bright: 0.8 },
      barUsed: 0.8,
      barRequested: 0.9
    })
    expect(entry.tooltip).toContain('· relaxed')
  })
})

// The app's tooltip rule, from the author (2026-09-23): "for any tooltips in
// the app, make them very succinct, no more than two or three words each".
// A live value readout counts as one word, not prose. These are the only
// tooltip strings in the app built as data rather than written inline in
// JSX, so they are the only ones a test can reach; the rest are literals in
// components and are held to the same rule by review.
describe('match meter tooltips are at most three words', () => {
  function wordCount(tooltip: string): number {
    return tooltip.split(/\s+/).filter((word) => word.length > 0 && word !== '·').length
  }

  const sources: DiscoverKindSource[] = ['confirmed', 'tag', 'guess']

  it('every mask entry tooltip', () => {
    for (const kind of DISCOVER_MASK_SLOT_KINDS) {
      for (const source of sources) {
        const [entry] = buildMatchMeter({
          kinds: [kind],
          kindSources: { [kind as DiscoverMaskKind]: source },
          traitPercentiles: {},
          barUsed: null
        })
        expect(wordCount(entry.tooltip), entry.tooltip).toBeLessThanOrEqual(3)
      }
    }
  })

  it('every trait entry tooltip, analysed, unanalysed and relaxed', () => {
    for (const kind of DISCOVER_TRAIT_SLOT_KINDS) {
      for (const percentile of [undefined, 0, 0.42, 1]) {
        for (const barUsed of [null, 0.4, 0.9]) {
          const [entry] = buildMatchMeter({
            kinds: [kind],
            kindSources: {},
            traitPercentiles: { [kind as DiscoverTraitKind]: percentile },
            barUsed,
            barRequested: 0.9
          })
          expect(wordCount(entry.tooltip), entry.tooltip).toBeLessThanOrEqual(3)
        }
      }
    }
  })
})
