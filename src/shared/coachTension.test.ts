import { describe, expect, it } from 'vitest'
import type { CoachSection } from './coachSections'
import {
  COACH_SWEEP_END_VALUE,
  COACH_SWEEP_START_VALUE,
  COACH_TENSION_KINDS,
  appliedTensionRiserId,
  coachRiserFieldsFor,
  coachSectionBoundaries,
  coachTensionDef,
  isCoachTensionKind,
  sanitiseCoachTension,
  tensionCurveFor,
  tensionIsApplied,
  tensionOffersAt,
  type CoachTensionApplied
} from './coachTension'

/** Sections are measured in PASSES now; these fixtures use a 4-bar phrase
 * throughout, so `passes: 4` is the old `bars: 16`. */
const PHRASE = 4

function section(over: Partial<CoachSection> & Pick<CoachSection, 'type'>): CoachSection {
  return {
    id: over.type,
    name: over.type,
    passes: 4,
    cells: {},
    startBar: 0,
    placedGroupIds: {},
    ...over
  }
}

describe('tensionOffersAt', () => {
  it('offers a sweep and a swell into anything named drop', () => {
    expect(tensionOffersAt('breakdown', 'drop')).toEqual(['filter-sweep', 'swell'])
    expect(tensionOffersAt('intro', 'drop')).toEqual(['filter-sweep', 'swell'])
  })

  it('adds the riser only at a build into a drop -- the spec names that pair', () => {
    expect(tensionOffersAt('build', 'drop')).toEqual(['filter-sweep', 'swell', 'riser'])
  })

  it('offers a fade into anything named breakdown', () => {
    expect(tensionOffersAt('drop', 'breakdown')).toEqual(['fade'])
  })

  it('offers nothing when neither name asks for anything', () => {
    expect(tensionOffersAt('intro', 'build')).toEqual([])
    expect(tensionOffersAt('drop', 'outro')).toEqual([])
    expect(tensionOffersAt('breakdown', 'build')).toEqual([])
  })

  it('never offers a swell and a fade at the same boundary -- they share one lane', () => {
    const types = ['intro', 'build', 'drop', 'breakdown', 'outro'] as const
    for (const from of types) {
      for (const into of types) {
        const offers = tensionOffersAt(from, into)
        expect(offers.includes('swell') && offers.includes('fade')).toBe(false)
      }
    }
  })
})

describe('coachSectionBoundaries', () => {
  const sections: CoachSection[] = [
    section({ id: 'a', type: 'intro', passes: 2, startBar: 0 }),
    section({ id: 'b', type: 'build', passes: 4, startBar: 8 }),
    section({ id: 'c', type: 'drop', passes: 4, startBar: 24 }),
    section({ id: 'd', type: 'outro', passes: 2, startBar: 40 })
  ]

  it('skips boundaries nothing is offered at, rather than listing empty rows', () => {
    expect(coachSectionBoundaries(sections, PHRASE).map((b) => b.index)).toEqual([1])
  })

  it('measures the join and the lead off the OUTGOING section', () => {
    const [boundary] = coachSectionBoundaries(sections, PHRASE)
    expect(boundary.from).toBe('build')
    expect(boundary.into).toBe('drop')
    expect(boundary.bar).toBe(24)
    expect(boundary.leadBars).toBe(16)
    expect(boundary.offers).toEqual(['filter-sweep', 'swell', 'riser'])
  })

  it('carries the names the user gave, for the panel to print', () => {
    const named = [
      section({ id: 'a', type: 'build', name: 'the long one', passes: 4, startBar: 0 }),
      section({ id: 'b', type: 'drop', name: 'the big one', passes: 4, startBar: 16 })
    ]
    const [boundary] = coachSectionBoundaries(named, PHRASE)
    expect(boundary.fromName).toBe('the long one')
    expect(boundary.intoName).toBe('the big one')
  })

  it('has no boundaries at all for one section, or none', () => {
    expect(coachSectionBoundaries([section({ type: 'drop' })], PHRASE)).toEqual([])
    expect(coachSectionBoundaries([], PHRASE)).toEqual([])
  })
})

describe('tensionCurveFor', () => {
  it('writes a swell as a plain fade in over the lead', () => {
    expect(tensionCurveFor('swell', [], { leadBars: 16, clipBars: 16 })).toEqual([
      { bar: 0, value: 0 },
      { bar: 16, value: 1 }
    ])
  })

  it('writes a fade as a plain fade out over the lead', () => {
    expect(tensionCurveFor('fade', [], { leadBars: 8, clipBars: 8 })).toEqual([
      { bar: 0, value: 1 },
      { bar: 8, value: 0 }
    ])
  })

  it('writes a sweep as a ramp ending wide open on the join', () => {
    expect(tensionCurveFor('filter-sweep', [], { leadBars: 16, clipBars: 16 })).toEqual([
      { bar: 0, value: COACH_SWEEP_START_VALUE },
      { bar: 16, value: COACH_SWEEP_END_VALUE }
    ])
  })

  it('clamps the lead to the clip, so a resized clip never gets a point past its end', () => {
    const points = tensionCurveFor('filter-sweep', [], { leadBars: 16, clipBars: 8 })
    expect(points).toEqual([
      { bar: 0, value: COACH_SWEEP_START_VALUE },
      { bar: 8, value: COACH_SWEEP_END_VALUE }
    ])
  })

  it('leaves a hand-drawn point outside the lead alone', () => {
    const existing = [
      { bar: 0, value: 0.5 },
      { bar: 2, value: 0.5 }
    ]
    const points = tensionCurveFor('filter-sweep', existing, { leadBars: 4, clipBars: 8 })
    expect(points).not.toBeNull()
    expect(points?.[0]).toEqual({ bar: 0, value: 0.5 })
    expect(points?.[(points?.length ?? 0) - 1]).toEqual({ bar: 8, value: COACH_SWEEP_END_VALUE })
  })

  it('has no curve for a riser -- a riser is a clip, not an envelope', () => {
    expect(tensionCurveFor('riser', [], { leadBars: 16, clipBars: 16 })).toBeNull()
  })

  it('returns null rather than a degenerate curve for a zero-length clip', () => {
    expect(tensionCurveFor('swell', [], { leadBars: 16, clipBars: 0 })).toBeNull()
  })
})

describe('coachRiserFieldsFor', () => {
  it('lands the riser on the join, pre-sized to the bars leading in', () => {
    expect(coachRiserFieldsFor({ bar: 24, leadBars: 16 })).toEqual({
      startBar: 8,
      lengthBars: 16
    })
  })

  it('never starts before bar zero', () => {
    expect(coachRiserFieldsFor({ bar: 4, leadBars: 16 }).startBar).toBe(0)
  })
})

describe('the applied record', () => {
  const applied: CoachTensionApplied[] = [
    { sectionIndex: 1, kind: 'filter-sweep', riserId: null },
    { sectionIndex: 1, kind: 'riser', riserId: 'riser-a' },
    { sectionIndex: 3, kind: 'riser', riserId: 'riser-b' }
  ]

  it('reports what is on at one boundary', () => {
    expect(tensionIsApplied(applied, 1, 'filter-sweep')).toBe(true)
    expect(tensionIsApplied(applied, 1, 'swell')).toBe(false)
    expect(tensionIsApplied(applied, 2, 'filter-sweep')).toBe(false)
  })

  it('finds the riser one boundary put down, so taking it off removes that one', () => {
    expect(appliedTensionRiserId(applied, 1)).toBe('riser-a')
    expect(appliedTensionRiserId(applied, 2)).toBeNull()
  })
})

describe('sanitiseCoachTension', () => {
  it('turns a missing field into an empty list rather than undefined', () => {
    expect(sanitiseCoachTension(undefined)).toEqual([])
    expect(sanitiseCoachTension(null)).toEqual([])
    expect(sanitiseCoachTension('nope')).toEqual([])
  })

  it('drops entries with an unknown kind or a nonsense index rather than guessing', () => {
    expect(
      sanitiseCoachTension([
        { sectionIndex: 0, kind: 'sidechain', riserId: null },
        { sectionIndex: -1, kind: 'swell', riserId: null },
        { sectionIndex: 1.5, kind: 'swell', riserId: null },
        { sectionIndex: 2, kind: 'swell', riserId: null }
      ])
    ).toEqual([{ sectionIndex: 2, kind: 'swell', riserId: null }])
  })

  it('keeps a riser id only when it is a real string', () => {
    expect(sanitiseCoachTension([{ sectionIndex: 0, kind: 'riser', riserId: 7 }])).toEqual([
      { sectionIndex: 0, kind: 'riser', riserId: null }
    ])
  })
})

describe('the offer table itself', () => {
  it('names every kind exactly once', () => {
    expect([...COACH_TENSION_KINDS].sort()).toEqual(
      ['fade', 'filter-sweep', 'riser', 'swell'].sort()
    )
  })

  it('obeys the copy rules on every label and hint', () => {
    for (const kind of COACH_TENSION_KINDS) {
      const def = coachTensionDef(kind)
      for (const text of [def.label, def.note]) {
        expect(text).not.toMatch(/!/)
        expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(text[0]).toBe(text[0].toLowerCase())
      }
    }
  })

  it('validates a persisted kind', () => {
    expect(isCoachTensionKind('riser')).toBe(true)
    expect(isCoachTensionKind('sidechain')).toBe(false)
    expect(isCoachTensionKind(3)).toBe(false)
  })
})
