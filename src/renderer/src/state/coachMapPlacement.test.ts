import { describe, expect, it } from 'vitest'
import { startCoach } from '@shared/coach'
import {
  lockClimaxFromArrangeRoles,
  type CoachStemSnapshot,
  type LockedClimax
} from '@shared/coachClimax'
import { planCellToggle, type MapClip } from '@shared/coachMapEdit'
import { readRowPasses } from '@shared/coachMapRead'
import { sectionBars } from '@shared/coachPasses'
import { buildCoachMapSections, coachMapRowOrder } from '@shared/coachMapTemplate'
import type { CoachSection } from '@shared/coachSections'
import type { Rifff } from '@shared/types'
import {
  buildCellToggleActions,
  buildCoachMapActions,
  buildMapRebuildActions
} from './coachMapPlacement'
import { coachMapRows } from './coachMapRows'
import { initialState, reducer, type Action, type AppState } from './store'

const PHRASE_BARS = 4

function stemSnapshot(path: string): CoachStemSnapshot {
  return { path, name: path, author: 'e', type: 'fx', durationSec: 4, barLength: 4 }
}

const climax: LockedClimax = lockClimaxFromArrangeRoles(
  [
    { stem: stemSnapshot('/kick.wav'), role: 'drums', gain: 1 },
    { stem: stemSnapshot('/bass.wav'), role: 'bass', gain: 1 },
    { stem: stemSnapshot('/hook.wav'), role: 'lead', gain: 1 }
  ],
  120,
  0
) as LockedClimax

const sections = buildCoachMapSections({
  shape: 'short',
  loopIs: 'drop',
  phraseBars: PHRASE_BARS,
  climax,
  firstStartBar: 0
})

const coach = {
  ...startCoach(0),
  lockedClimax: climax,
  loopIs: 'drop' as const,
  shape: 'short' as const,
  phrase: { bars: PHRASE_BARS, source: 'nominal' as const },
  sections
}

const state: AppState = { ...initialState, bpm: 120, coach }

function applyAll(from: AppState, actions: readonly Action[]): AppState {
  return actions.reduce((acc, action) => reducer(acc, action), from)
}

/** The source loop the auto-arranger read, so the build has something to
 * replace. */
function withSourceLoop(base: AppState): AppState {
  const src: Rifff = {
    groupId: 'src',
    name: 'loop',
    bpm: 120,
    barLength: 4,
    folderPath: '/x',
    startBar: 0,
    stems: [
      {
        slot: 1,
        author: 'e',
        name: '/kick.wav',
        type: 'drums',
        path: '/kick.wav',
        durationSec: 4,
        barLength: 4
      }
    ]
  }
  return { ...base, rifffs: { src }, channelOf: { src: 'src' }, channelOrder: ['src'] }
}

/** What the reducer would hold after the build's own
 * COACH_RECORD_MAP_PLACEMENT -- written directly here so this file does not
 * depend on an action Task 7 adds. */
function recorded(built: ReturnType<typeof buildCoachMapActions>, base: AppState): AppState {
  const next = base.coach
  if (next === null) return base
  return {
    ...base,
    coach: {
      ...next,
      sections: next.sections.map((section): CoachSection => {
        const placed = built.placedGroupIds[section.id]
        return placed === undefined ? section : { ...section, placedGroupIds: placed }
      })
    }
  }
}

describe('buildCoachMapActions', () => {
  it('places every section at its OWN start bar, not one after another', () => {
    const built = buildCoachMapActions(state, coach, sections)
    const bars = built.actions
      .filter((a) => a.type === 'PLACE_LOOP_ON_TIMELINE')
      .map((a) => (a as { startBar: number }).startBar)
    expect(bars).toContain(sections[0].startBar)
    expect(bars).toContain(sections[1].startBar)
  })

  it('starts the very first section at bar zero, never one phrase late', () => {
    // passOffsetBars, not sectionBars: sectionBars floors passes at one, so
    // using it for a pass-ZERO offset lands the opening clip a whole phrase
    // into the section.
    const built = buildCoachMapActions(state, coach, sections)
    const bars = built.actions
      .filter((a) => a.type === 'PLACE_LOOP_ON_TIMELINE')
      .map((a) => (a as { startBar: number }).startBar)
    expect(Math.min(...bars)).toBe(0)
  })

  it('creates the lanes in MAP ROW ORDER, so the arranger rows match the map', () => {
    // Rows outer, sections inner. The first clip placed for each stem is the
    // one that makes its lane, and channelOrder takes them in the order they
    // are placed. So: walk the placements in order, resolve each groupId back
    // to the path it was placed for, and keep the first sighting of each
    // path. That sequence must be the map's row order.
    const built = buildCoachMapActions(state, coach, sections)
    const pathByGroupId: Record<string, string> = {}
    for (const perSection of Object.values(built.placedGroupIds)) {
      for (const [path, groupId] of Object.entries(perSection)) pathByGroupId[groupId] = path
    }
    const firstSighting: string[] = []
    for (const action of built.actions) {
      if (action.type !== 'PLACE_LOOP_ON_TIMELINE') continue
      for (const rifff of action.stems) {
        const path = pathByGroupId[rifff.groupId] ?? rifff.stems[0]?.path
        if (path !== undefined && !firstSighting.includes(path)) firstSighting.push(path)
      }
    }
    expect(firstSighting).toEqual(coachMapRowOrder(climax).map((stem) => stem.path))
  })

  it('gives one stem ONE row for the whole song, in the map own order', () => {
    const built = buildCoachMapActions(state, coach, sections)
    const after = recorded(built, applyAll(state, built.actions))
    const rows = coachMapRows(after)
    expect(rows.map((row) => row.path)).toEqual(coachMapRowOrder(climax).map((stem) => stem.path))
    expect(rows.every((row) => row.kind === 'stem')).toBe(true)
  })

  it('sets each clip length from its RUN, not from its section', () => {
    // A stem that plays 2 of a 4-pass section gets a 2-pass clip.
    const built = buildCoachMapActions(state, coach, sections)
    const resizes = built.actions.filter((a) => a.type === 'SET_PLAYED_BARS')
    expect(resizes.length).toBeGreaterThan(0)
    for (const resize of resizes) {
      expect((resize as { bars: number }).bars % PHRASE_BARS).toBe(0)
    }
  })

  it('records a groupId per path per SECTION ID, for the round trip to read', () => {
    const built = buildCoachMapActions(state, coach, sections)
    expect(Object.keys(built.placedGroupIds)).toEqual(sections.map((s) => s.id))
  })

  it('deletes the material it replaced, AFTER placing -- never before', () => {
    const built = buildCoachMapActions(withSourceLoop(state), coach, sections)
    const deleteIndex = built.actions.findIndex((a) => a.type === 'DELETE_RIFFFS')
    const lastPlace = built.actions.map((a) => a.type).lastIndexOf('PLACE_LOOP_ON_TIMELINE')
    expect(deleteIndex).toBeGreaterThan(lastPlace)
    expect((built.actions[deleteIndex] as { groupIds: string[] }).groupIds).toEqual(['src'])
  })

  it('places nothing at all when the climax is empty', () => {
    expect(buildCoachMapActions(state, { ...coach, lockedClimax: null }, sections).actions).toEqual(
      []
    )
  })

  it('lays out a map the map itself can read back, section by section', () => {
    // The build and the read half closing on each other: the drop is the
    // home section, so every stem plays every pass of it.
    const built = buildCoachMapActions(state, coach, sections)
    const after = recorded(built, applyAll(state, built.actions))
    const drop = sections.find((s) => s.type === 'drop') as CoachSection
    for (const row of coachMapRows(after)) {
      const passes = readRowPasses(row.clips, drop, PHRASE_BARS)
      expect(passes.every((on) => on)).toBe(true)
    }
  })
})

describe('buildCellToggleActions', () => {
  const built = buildCoachMapActions(state, coach, sections)
  const afterBuild = recorded(built, applyAll(state, built.actions))
  const row = coachMapRows(afterBuild)[0]
  const section = sections.find((s) => s.type === 'verse') as CoachSection
  const plan = planCellToggle({
    clips: row.clips,
    section,
    phraseBars: PHRASE_BARS,
    passIndex: 0,
    on: false
  })

  function grid(clips: readonly MapClip[]): string {
    return readRowPasses(clips, section, PHRASE_BARS)
      .map((on) => (on ? 'x' : '.'))
      .join('')
  }

  it('turns a plan into a delete plus one placement per run', () => {
    const actions = buildCellToggleActions(afterBuild, row, section, plan, climax, PHRASE_BARS)
    expect(actions.filter((a) => a.type === 'DELETE_RIFFFS')).toHaveLength(1)
    expect(actions.filter((a) => a.type === 'PLACE_LOOP_ON_TIMELINE')).toHaveLength(
      plan.addRuns.length
    )
  })

  it('puts every new clip on the row own channel', () => {
    const actions = buildCellToggleActions(afterBuild, row, section, plan, climax, PHRASE_BARS)
    for (const move of actions.filter((a) => a.type === 'MOVE_TO_CHANNEL')) {
      expect((move as { channelId: string }).channelId).toBe(row.channelId)
    }
  })

  it('does nothing at all for a blocked plan', () => {
    const blocked = { removeGroupIds: [], addRuns: [], blockedGroupIds: ['x'] }
    expect(buildCellToggleActions(afterBuild, row, section, blocked, climax, PHRASE_BARS)).toEqual(
      []
    )
  })

  it('does nothing at all for a row the map does not own', () => {
    const other = { ...row, path: null }
    expect(buildCellToggleActions(afterBuild, other, section, plan, climax, PHRASE_BARS)).toEqual(
      []
    )
  })

  it('CLOSES THE ROUND TRIP THROUGH THE REAL REDUCER -- read, toggle, apply, read', () => {
    // The pure round trip is tested in @shared/coachMapEdit. This one runs
    // the same loop through the real actions and the real row reader: the
    // cell that was asked to go off comes back off, and nothing else moved.
    const before = grid(row.clips)
    expect(before[0]).toBe('x')
    const actions = buildCellToggleActions(afterBuild, row, section, plan, climax, PHRASE_BARS)
    const after = applyAll(afterBuild, actions)
    const toggled = coachMapRows(after).find((r) => r.channelId === row.channelId) as {
      clips: MapClip[]
    }
    expect(grid(toggled.clips)).toBe(`.${before.slice(1)}`)
  })
})

describe('buildMapRebuildActions', () => {
  // A whole second fixture at an EIGHT bar phrase, so halving it to four is
  // a real change with a real re-lay behind it.
  const PHRASE_8 = 8
  const sections8 = buildCoachMapSections({
    shape: 'short',
    loopIs: 'drop',
    phraseBars: PHRASE_8,
    climax,
    firstStartBar: 0
  })
  const coach8 = {
    ...coach,
    phrase: { bars: PHRASE_8, source: 'nominal' as const },
    sections: sections8
  }
  const state8: AppState = { ...initialState, bpm: 120, coach: coach8 }
  const built8 = buildCoachMapActions(state8, coach8, sections8)
  const placed8 = recorded(built8, applyAll(state8, built8.actions))
  const coachPlaced8 = placed8.coach as NonNullable<AppState['coach']>

  it('keeps every section id, name and type across a phrase change', () => {
    const built = buildMapRebuildActions(placed8, coachPlaced8, 4)
    expect(built.sections.map((s) => s.id)).toEqual(coachPlaced8.sections.map((s) => s.id))
    expect(built.sections.map((s) => s.name)).toEqual(coachPlaced8.sections.map((s) => s.name))
    expect(built.sections.map((s) => s.type)).toEqual(coachPlaced8.sections.map((s) => s.type))
  })

  it('keeps each section about the same number of BARS at the new phrase', () => {
    const built = buildMapRebuildActions(placed8, coachPlaced8, 4)
    for (const [index, section] of built.sections.entries()) {
      expect(sectionBars(section.passes, 4)).toBe(
        sectionBars(coachPlaced8.sections[index].passes, PHRASE_8)
      )
    }
  })

  it('carries a USER edit across, not the build-time cells', () => {
    // A square switched off by a CLICK on the map, through the real toggle
    // path -- so the clip is gone while section.cells still says {}.
    const verse = coachPlaced8.sections.find((s) => s.type === 'verse') as CoachSection
    expect(verse.passes).toBeGreaterThanOrEqual(2)
    expect(verse.cells).toEqual({})
    const row = coachMapRows(placed8)[0]
    expect(readRowPasses(row.clips, verse, PHRASE_8)[1]).toBe(true)
    const off = planCellToggle({
      clips: row.clips,
      section: verse,
      phraseBars: PHRASE_8,
      passIndex: 1,
      on: false
    })
    const edited = applyAll(
      placed8,
      buildCellToggleActions(placed8, row, verse, off, climax, PHRASE_8)
    )
    const editedCoach = edited.coach as NonNullable<AppState['coach']>

    const built = buildMapRebuildActions(edited, editedCoach, 4)
    const rebuiltVerse = built.sections.find((s) => s.id === verse.id) as CoachSection
    // At half the phrase, that one 8-bar pass is two 4-bar ones.
    expect(rebuiltVerse.cells[`2|${row.path}`]).toBe(false)
    expect(rebuiltVerse.cells[`3|${row.path}`]).toBe(false)
    expect(rebuiltVerse.cells[`0|${row.path}`]).toBe(true)
  })

  it('deletes the old clips after placing the new ones', () => {
    const built = buildMapRebuildActions(placed8, coachPlaced8, 4)
    const deleteIndex = built.actions.findIndex((a) => a.type === 'DELETE_RIFFFS')
    const lastPlace = built.actions.map((a) => a.type).lastIndexOf('PLACE_LOOP_ON_TIMELINE')
    expect(deleteIndex).toBeGreaterThan(lastPlace)
  })

  it('lays the new clips out at the NEW phrase, not the old one', () => {
    // The whole re-lay is worthless if the clips keep the old scale: every
    // section's window would point at bars its clips no longer occupy.
    const built = buildMapRebuildActions(placed8, coachPlaced8, 4)
    const after = recorded(
      built,
      applyAll({ ...placed8, coach: { ...coachPlaced8, sections: built.sections } }, built.actions)
    )
    const drop = built.sections.find((s) => s.type === 'drop') as CoachSection
    for (const row of coachMapRows(after).filter((r) => r.kind === 'stem')) {
      expect(readRowPasses(row.clips, drop, 4).every((on) => on)).toBe(true)
    }
  })

  it('does nothing at all when the phrase did not change', () => {
    expect(buildMapRebuildActions(placed8, coachPlaced8, PHRASE_8).actions).toEqual([])
  })

  it('does nothing at all when there is no map yet', () => {
    expect(buildMapRebuildActions(state, { ...coach, sections: [] }, 8).actions).toEqual([])
  })
})
