import { describe, expect, it } from 'vitest'
import type { LockedClimax, LockedClimaxStem } from './coachClimax'
import {
  COACH_FIRST_SECTION_TYPES,
  COACH_SECTION_DROP_SETS,
  COACH_SECTION_MAX_BARS,
  COACH_SECTION_MIN_BARS,
  COACH_SECTION_TRANSITIONS,
  COACH_SECTION_TYPES,
  coachSectionTypeDef,
  defaultSectionName,
  isCoachSectionType,
  newCoachSectionDraft,
  nextCoachSectionStartBar,
  nextSectionTypeSuggestions,
  nudgeSectionBars,
  sanitiseCoachSectionDraft,
  sanitiseCoachSections,
  sectionKeptStems,
  sectionLaneChannelIds,
  suggestedDropPaths,
  type CoachSection
} from './coachSections'

function stem(path: string, kinds: LockedClimaxStem['kinds']): LockedClimaxStem {
  return {
    path,
    name: path,
    author: 'e',
    type: 'fx',
    durationSec: 4,
    barLength: 4,
    kinds,
    role: 'aux',
    gain: 1
  }
}

const climax: LockedClimax = {
  bpm: 120,
  barLength: 4,
  lockedAt: 0,
  stems: [
    stem('/kick.wav', ['drums']),
    stem('/bass.wav', ['bass']),
    stem('/harmony.wav', ['lead', 'warm']),
    stem('/hook.wav', ['lead', 'bright']),
    stem('/perc.wav', ['bassHeavy'])
  ]
}

describe('the section types', () => {
  it('are the five the spec names, in flow order', () => {
    expect(COACH_SECTION_TYPES.map((t) => t.id)).toEqual([
      'intro',
      'build',
      'drop',
      'breakdown',
      'outro'
    ])
  })

  it('carry a default length that is a whole number of four-bar steps', () => {
    for (const type of COACH_SECTION_TYPES) {
      expect(type.defaultBars % 4).toBe(0)
      expect(type.defaultBars).toBeGreaterThanOrEqual(COACH_SECTION_MIN_BARS)
      expect(type.defaultBars).toBeLessThanOrEqual(COACH_SECTION_MAX_BARS)
    }
    expect(coachSectionTypeDef('drop').defaultBars).toBe(16)
  })

  it('narrow a persisted string', () => {
    expect(isCoachSectionType('breakdown')).toBe(true)
    expect(isCoachSectionType('chorus')).toBe(false)
    expect(isCoachSectionType(7)).toBe(false)
  })
})

describe('nudgeSectionBars', () => {
  it('moves by the given step and clamps at both ends', () => {
    expect(nudgeSectionBars(8, 4)).toBe(12)
    expect(nudgeSectionBars(8, -4)).toBe(4)
    expect(nudgeSectionBars(8, 8)).toBe(16)
    expect(nudgeSectionBars(COACH_SECTION_MIN_BARS, -8)).toBe(COACH_SECTION_MIN_BARS)
    expect(nudgeSectionBars(COACH_SECTION_MAX_BARS, 8)).toBe(COACH_SECTION_MAX_BARS)
  })
})

describe('defaultSectionName', () => {
  it('is the type, and numbers repeats from the second one on', () => {
    expect(defaultSectionName('drop', [])).toBe('drop')
    const placed = [
      { type: 'drop' as const, name: 'drop' },
      { type: 'breakdown' as const, name: 'breakdown' }
    ]
    expect(defaultSectionName('drop', placed)).toBe('drop 2')
    expect(defaultSectionName('outro', placed)).toBe('outro')
  })
})

describe('a fresh section draft', () => {
  it('HAS EVERY STEM ON -- nothing is dropped until the user says so', () => {
    // The rule of this whole phase. If this test ever fails because a
    // constructor started pre-applying the suggestion table, the fix is in
    // the constructor, never here.
    const draft = newCoachSectionDraft('intro', [])
    expect(draft.droppedPaths).toEqual([])
    expect(sectionKeptStems(climax, draft.droppedPaths)).toHaveLength(climax.stems.length)
  })

  it('takes its name and length from the type', () => {
    const draft = newCoachSectionDraft('build', [])
    expect(draft.type).toBe('build')
    expect(draft.name).toBe('build')
    expect(draft.bars).toBe(coachSectionTypeDef('build').defaultBars)
  })
})

describe('the suggested-drop table', () => {
  it('flags harmony and the hook in an intro and an outro', () => {
    expect(suggestedDropPaths('intro', climax)).toEqual(['/harmony.wav', '/hook.wav'])
    expect(suggestedDropPaths('outro', climax)).toEqual(['/harmony.wav', '/hook.wav'])
  })

  it('flags only the hook in a build', () => {
    expect(suggestedDropPaths('build', climax)).toEqual(['/hook.wav'])
  })

  it('flags the kick and the bass in a breakdown', () => {
    expect(suggestedDropPaths('breakdown', climax)).toEqual(['/kick.wav', '/bass.wav'])
  })

  it('flags NOTHING in a drop -- that section is the whole loop', () => {
    expect(COACH_SECTION_DROP_SETS.drop).toEqual([])
    expect(suggestedDropPaths('drop', climax)).toEqual([])
  })

  it('reads the kinds Discover tagged, never the stem order', () => {
    const reversed: LockedClimax = { ...climax, stems: [...climax.stems].reverse() }
    expect(suggestedDropPaths('build', reversed)).toEqual(['/hook.wav'])
    // A stem with no kinds at all is never flagged -- there is nothing to
    // key off, so the app says nothing about it.
    const untagged: LockedClimax = { ...climax, stems: [stem('/mystery.wav', [])] }
    expect(suggestedDropPaths('intro', untagged)).toEqual([])
  })
})

describe('the transition table', () => {
  it('follows the spec: after build a drop, after a drop a breakdown or an outro', () => {
    expect(COACH_SECTION_TRANSITIONS.build).toEqual(['drop'])
    expect(COACH_SECTION_TRANSITIONS.drop).toEqual(['breakdown', 'outro'])
    expect(COACH_SECTION_TRANSITIONS.intro).toEqual(['build', 'drop'])
    expect(COACH_SECTION_TRANSITIONS.breakdown).toEqual(['build', 'drop'])
    // An outro ends phase two, so nothing follows it.
    expect(COACH_SECTION_TRANSITIONS.outro).toEqual([])
  })

  it('suggests the first section when nothing is placed yet', () => {
    expect(COACH_FIRST_SECTION_TYPES).toEqual(['intro', 'build'])
    expect(nextSectionTypeSuggestions([])).toEqual(['intro', 'build'])
  })

  it('suggests from the last placed section otherwise', () => {
    const sections: CoachSection[] = [
      { type: 'intro', name: 'intro', bars: 8, droppedPaths: [], startBar: 0, placedGroupIds: {} },
      { type: 'build', name: 'build', bars: 16, droppedPaths: [], startBar: 8, placedGroupIds: {} }
    ]
    expect(nextSectionTypeSuggestions(sections)).toEqual(['drop'])
  })
})

describe('placement arithmetic', () => {
  const sections: CoachSection[] = [
    {
      type: 'intro',
      name: 'intro',
      bars: 8,
      droppedPaths: ['/hook.wav'],
      startBar: 12,
      placedGroupIds: { '/kick.wav': 'g1', '/bass.wav': 'g2' }
    }
  ]

  it('starts the first section after everything already placed', () => {
    expect(nextCoachSectionStartBar([], 0)).toBe(0)
    expect(nextCoachSectionStartBar([], 12)).toBe(12)
  })

  it('starts every later section right after the previous one', () => {
    expect(nextCoachSectionStartBar(sections, 999)).toBe(20)
  })

  it('remembers which channel each stem already owns', () => {
    expect(sectionLaneChannelIds(sections)).toEqual({ '/kick.wav': 'g1', '/bass.wav': 'g2' })
  })

  it('keeps the FIRST lane a stem was given, not the newest one', () => {
    const twice: CoachSection[] = [
      ...sections,
      {
        type: 'drop',
        name: 'drop',
        bars: 16,
        droppedPaths: [],
        startBar: 20,
        placedGroupIds: { '/kick.wav': 'g9' }
      }
    ]
    expect(sectionLaneChannelIds(twice)['/kick.wav']).toBe('g1')
  })

  it('keeps the stems the user did not switch off, in climax order', () => {
    expect(sectionKeptStems(climax, ['/hook.wav', '/perc.wav']).map((s) => s.path)).toEqual([
      '/kick.wav',
      '/bass.wav',
      '/harmony.wav'
    ])
  })
})

describe('load repair', () => {
  it('turns nonsense into an empty list rather than throwing', () => {
    expect(sanitiseCoachSections(undefined)).toEqual([])
    expect(sanitiseCoachSections('nope')).toEqual([])
    expect(sanitiseCoachSections([{ type: 'chorus' }])).toEqual([])
  })

  it('repairs a hand-edited section', () => {
    expect(
      sanitiseCoachSections([
        { type: 'drop', name: 42, bars: -3, droppedPaths: ['/a', 7], startBar: -9 }
      ])
    ).toEqual([
      {
        type: 'drop',
        name: 'drop',
        bars: COACH_SECTION_MIN_BARS,
        droppedPaths: ['/a'],
        startBar: 0,
        placedGroupIds: {}
      }
    ])
  })

  it('repairs or discards a draft', () => {
    expect(sanitiseCoachSectionDraft(null)).toBeNull()
    expect(sanitiseCoachSectionDraft({ type: 'nope' })).toBeNull()
    expect(sanitiseCoachSectionDraft({ type: 'build' })).toEqual({
      type: 'build',
      name: 'build',
      bars: 16,
      droppedPaths: []
    })
  })
})
