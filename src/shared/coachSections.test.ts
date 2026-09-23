import { describe, expect, it } from 'vitest'
import type { LockedClimax, LockedClimaxStem } from './coachClimax'
import { cellIsOn, setCell } from './coachCells'
import {
  COACH_FIRST_SECTION_TYPES,
  COACH_SECTION_DROP_SETS,
  COACH_SECTION_TRANSITIONS,
  COACH_SECTION_TYPES,
  coachSectionTypeDef,
  defaultSectionName,
  isCoachSectionType,
  isSuggestedDrop,
  newCoachSectionDraft,
  nextCoachSectionStartBar,
  nextSectionTypeSuggestions,
  sanitiseCoachSectionDraft,
  sanitiseCoachSections,
  sectionLaneChannelIds,
  sectionStemsInPass,
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

/** The template answer used by the tests below that do not care what it is:
 * "everything plays in every pass". */
const allOn = (): boolean => true

describe('the section types', () => {
  it('are the six the spec names, in flow order', () => {
    expect(COACH_SECTION_TYPES.map((t) => t.id)).toEqual([
      'intro',
      'verse',
      'build',
      'drop',
      'breakdown',
      'outro'
    ])
  })

  it('carry a label and nothing else -- length comes from the shape template now', () => {
    for (const type of COACH_SECTION_TYPES) {
      expect(type.label).toBe(type.id)
      expect('defaultBars' in type).toBe(false)
    }
    expect(coachSectionTypeDef('drop').label).toBe('drop')
  })

  it('narrow a persisted string', () => {
    expect(isCoachSectionType('breakdown')).toBe(true)
    expect(isCoachSectionType('verse')).toBe(true)
    expect(isCoachSectionType('chorus')).toBe(false)
    expect(isCoachSectionType(7)).toBe(false)
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
  it('a fresh draft overrides NOTHING -- the template fills it in', () => {
    // The reversal of the old everything-on rule. `cells: {}` does not mean
    // "nothing plays" -- it means "nothing has been overridden", so every
    // cell reads the template (./coachMapTemplate.ts).
    expect(newCoachSectionDraft('intro', [], 2).cells).toEqual({})
  })

  it('takes its name from the type and its length from the caller', () => {
    const draft = newCoachSectionDraft('build', [], 3)
    expect(draft.type).toBe('build')
    expect(draft.name).toBe('build')
    expect(draft.passes).toBe(3)
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

  it('adds a verse, which loses the hook and keeps the harmony', () => {
    expect(COACH_SECTION_DROP_SETS.verse).toEqual([['lead', 'bright']])
    expect(isSuggestedDrop('verse', stem('/hook.wav', ['lead', 'bright']))).toBe(true)
    expect(isSuggestedDrop('verse', stem('/harmony.wav', ['lead', 'warm']))).toBe(false)
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
  it('follows the spec, and routes through the verse', () => {
    expect(COACH_SECTION_TRANSITIONS.intro).toEqual(['verse', 'build', 'drop'])
    expect(COACH_SECTION_TRANSITIONS.verse).toEqual(['build', 'drop'])
    expect(COACH_SECTION_TRANSITIONS.build).toEqual(['drop'])
    expect(COACH_SECTION_TRANSITIONS.drop).toEqual(['verse', 'breakdown', 'outro'])
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
      {
        id: 's0',
        type: 'intro',
        name: 'intro',
        passes: 2,
        cells: {},
        startBar: 0,
        placedGroupIds: {}
      },
      {
        id: 's1',
        type: 'build',
        name: 'build',
        passes: 4,
        cells: {},
        startBar: 8,
        placedGroupIds: {}
      }
    ]
    expect(nextSectionTypeSuggestions(sections)).toEqual(['drop'])
  })
})

describe('placement arithmetic', () => {
  const sections: CoachSection[] = [
    {
      id: 's0',
      type: 'intro',
      name: 'intro',
      passes: 2,
      cells: {},
      startBar: 12,
      placedGroupIds: { '/kick.wav': 'g1', '/bass.wav': 'g2' }
    }
  ]

  it('starts the first section after everything already placed', () => {
    expect(nextCoachSectionStartBar([], 0, 4)).toBe(0)
    expect(nextCoachSectionStartBar([], 12, 4)).toBe(12)
  })

  it('starts every later section right after the previous one, in PASSES', () => {
    expect(nextCoachSectionStartBar(sections, 999, 4)).toBe(20)
    // The same two passes at an 8-bar phrase are twice as long.
    expect(nextCoachSectionStartBar(sections, 999, 8)).toBe(28)
  })

  it('remembers which channel each stem already owns', () => {
    expect(sectionLaneChannelIds(sections)).toEqual({ '/kick.wav': 'g1', '/bass.wav': 'g2' })
  })

  it('keeps the FIRST lane a stem was given, not the newest one', () => {
    const twice: CoachSection[] = [
      ...sections,
      {
        id: 's1',
        type: 'drop',
        name: 'drop',
        passes: 4,
        cells: {},
        startBar: 20,
        placedGroupIds: { '/kick.wav': 'g9' }
      }
    ]
    expect(sectionLaneChannelIds(twice)['/kick.wav']).toBe('g1')
  })
})

describe('sectionStemsInPass', () => {
  it('asks the template for a cell nobody touched', () => {
    const played = sectionStemsInPass({ cells: {} }, 0, climax.stems, allOn)
    expect(played).toHaveLength(climax.stems.length)
  })

  it('lets an override beat the template, per pass', () => {
    const cells = setCell({}, 1, '/hook.wav', false)
    expect(sectionStemsInPass({ cells }, 0, climax.stems, allOn).map((s) => s.path)).toContain(
      '/hook.wav'
    )
    expect(sectionStemsInPass({ cells }, 1, climax.stems, allOn).map((s) => s.path)).not.toContain(
      '/hook.wav'
    )
  })

  it('keeps the order it was handed', () => {
    const arrivesLate = (_stem: LockedClimaxStem, passIndex: number): boolean => passIndex >= 1
    expect(sectionStemsInPass({ cells: {} }, 0, climax.stems, arrivesLate)).toEqual([])
    expect(
      sectionStemsInPass({ cells: {} }, 1, climax.stems, arrivesLate).map((s) => s.path)
    ).toEqual(climax.stems.map((s) => s.path))
  })
})

describe('load repair', () => {
  it('turns nonsense into an empty list rather than throwing', () => {
    expect(sanitiseCoachSections(undefined, 4)).toEqual([])
    expect(sanitiseCoachSections('nope', 4)).toEqual([])
    expect(sanitiseCoachSections([{ type: 'chorus' }], 4)).toEqual([])
  })

  it('repairs a hand-edited section', () => {
    expect(
      sanitiseCoachSections(
        [{ type: 'drop', name: 42, passes: -3, cells: { nonsense: true }, startBar: -9 }],
        4
      )
    ).toEqual([
      {
        id: 'section-0',
        type: 'drop',
        name: 'drop',
        passes: 1,
        cells: {},
        startBar: 0,
        placedGroupIds: {}
      }
    ])
  })

  it('brings a pre-map section up to shape, dropped paths and all', () => {
    const loaded = sanitiseCoachSections(
      [{ type: 'intro', name: 'intro', bars: 16, droppedPaths: ['/hook.wav'], startBar: 0 }],
      4
    )
    expect(loaded[0].passes).toBe(4)
    expect(loaded[0].id).not.toBe('')
    expect(cellIsOn(loaded[0].cells, 0, '/hook.wav', true)).toBe(false)
    expect(cellIsOn(loaded[0].cells, 3, '/hook.wav', true)).toBe(false)
    expect(cellIsOn(loaded[0].cells, 0, '/kick.wav', true)).toBe(true)
  })

  it('keeps a saved id rather than reminting it', () => {
    const loaded = sanitiseCoachSections([{ id: 'map-2-drop', type: 'drop', passes: 2 }], 4)
    expect(loaded[0].id).toBe('map-2-drop')
  })

  it('repairs or discards a draft', () => {
    expect(sanitiseCoachSectionDraft(null, 4)).toBeNull()
    expect(sanitiseCoachSectionDraft({ type: 'nope' }, 4)).toBeNull()
    expect(sanitiseCoachSectionDraft({ type: 'build' }, 4)).toEqual({
      type: 'build',
      name: 'build',
      passes: 1,
      cells: {}
    })
  })

  it('migrates a pre-map draft at the phrase length the project now has', () => {
    expect(sanitiseCoachSectionDraft({ type: 'build', bars: 16, droppedPaths: [] }, 8)).toEqual({
      type: 'build',
      name: 'build',
      passes: 2,
      cells: {}
    })
  })
})
