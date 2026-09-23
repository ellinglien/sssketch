import { describe, expect, it } from 'vitest'
import { startCoach } from '@shared/coach'
import {
  lockClimaxFromArrangeRoles,
  type CoachStemSnapshot,
  type LockedClimax
} from '@shared/coachClimax'
import { planCellToggle } from '@shared/coachMapEdit'
import { buildCoachMapSections } from '@shared/coachMapTemplate'
import { coachBoundaries } from '@shared/coachPhase3'
import { tensionIsApplied } from '@shared/coachTension'
import { createRiser } from '@shared/riser'
import { stemKey, type Rifff } from '@shared/types'
import type { CoachSection } from '@shared/coachSections'
import { buildCellToggleActions, buildCoachMapActions } from './coachMapPlacement'
import { createHistoryState, historyReducer } from './history'
import { coachMapRows } from './coachMapRows'
import {
  buildCoachTensionActions,
  buildCoachTensionRemovalActions,
  coachTensionHasMaterial
} from './coachTensionApply'
import { initialState, reducer, type AppState } from './store'

function rifff(groupId: string, startBar: number): Rifff {
  return {
    groupId,
    name: groupId,
    bpm: 120,
    barLength: 4,
    folderPath: '/tmp',
    startBar,
    stems: [
      {
        slot: 1,
        author: 'a',
        name: `${groupId} stem`,
        type: 'drums',
        path: `/tmp/${groupId}.wav`,
        durationSec: 8,
        barLength: 4
      }
    ]
  }
}

/** Four passes of a four-bar phrase -- sixteen bars, but stored the only way
 * a section ever stores its length (@shared/coachPasses). Every bar number
 * below comes out of `passes` times the phrase the coach state carries, not
 * out of a bar count written on the section. */
const section: CoachSection = {
  id: 'section-0',
  type: 'build',
  name: 'build',
  passes: 4,
  cells: {},
  startBar: 8,
  placedGroupIds: { '/tmp/a.wav': 'a', '/tmp/b.wav': 'b' }
}

function placed(): AppState {
  return {
    ...initialState,
    bpm: 120,
    coach: { ...startCoach(0), phrase: { bars: 4, source: 'measured' } },
    rifffs: { a: rifff('a', 8), b: rifff('b', 8) },
    playedBars: { a: 16, b: 16 },
    stretch: { a: true, b: true },
    channelOf: { a: 'a', b: 'b' },
    channelOrder: ['a', 'b']
  }
}

const ids = { riserId: 'riser-1', channelId: 'channel-new' }

describe('buildCoachTensionActions -- the curve moves', () => {
  it('writes one group automation per clip in the section', () => {
    const { actions, riserId } = buildCoachTensionActions(placed(), section, 'swell', ids)
    expect(riserId).toBeNull()
    expect(actions).toEqual([
      {
        type: 'SET_GROUP_AUTOMATION',
        groupId: 'a',
        param: 'volume',
        points: [
          { bar: 0, value: 0 },
          { bar: 16, value: 1 }
        ]
      },
      {
        type: 'SET_GROUP_AUTOMATION',
        groupId: 'b',
        param: 'volume',
        points: [
          { bar: 0, value: 0 },
          { bar: 16, value: 1 }
        ]
      }
    ])
  })

  it('writes the sweep onto the filter lane, not the volume lane', () => {
    const { actions } = buildCoachTensionActions(placed(), section, 'filter-sweep', ids)
    expect(
      actions.every((a) => a.type === 'SET_GROUP_AUTOMATION' && a.param === 'filterCutoff')
    ).toBe(true)
  })

  it('really lands on the clips when the reducer runs it', () => {
    const state = placed()
    const { actions } = buildCoachTensionActions(state, section, 'fade', ids)
    const after = actions.reduce(reducer, state)
    expect(after.stemAutomation[stemKey('a', 1)]?.volume).toEqual([
      { bar: 0, value: 1 },
      { bar: 16, value: 0 }
    ])
  })

  it('measures the clip"s REAL length, not the section"s, so a resize is respected', () => {
    const state = { ...placed(), playedBars: { a: 8, b: 16 } }
    const { actions } = buildCoachTensionActions(state, section, 'fade', ids)
    const first = actions[0]
    expect(first.type).toBe('SET_GROUP_AUTOMATION')
    if (first.type === 'SET_GROUP_AUTOMATION') {
      expect(first.points[first.points.length - 1].bar).toBe(8)
    }
  })

  it('gets the section"s length from its passes and the user"s own phrase', () => {
    // The same four-pass section, against a loop the user called eight bars:
    // thirty-two bars of build, and the curve has to span all of it.
    const state = {
      ...placed(),
      coach: { ...startCoach(0), phrase: { bars: 8, source: 'nominal' as const } },
      playedBars: { a: 32, b: 32 }
    }
    const { actions } = buildCoachTensionActions(state, section, 'swell', ids)
    const first = actions[0]
    if (first.type !== 'SET_GROUP_AUTOMATION') throw new Error('expected an automation write')
    expect(first.points[first.points.length - 1].bar).toBe(32)
  })

  it('skips a clip the user has since deleted rather than throwing', () => {
    const state = { ...placed(), rifffs: { a: rifff('a', 8) } }
    const { actions } = buildCoachTensionActions(state, section, 'swell', ids)
    expect(actions).toHaveLength(1)
  })

  it('finds the clips that are REALLY in the section, not the ids the build recorded', () => {
    // Every edit on the arrangement map DELETES a clip and places a fresh
    // one in its place, on the same row, with a new groupId -- and nothing
    // ever re-records section.placedGroupIds. So by the time the tension
    // pass runs, that record names clips that no longer exist, and reading
    // it finds nothing to write to: a toggle that does nothing at all.
    const state: AppState = {
      ...placed(),
      rifffs: { a2: rifff('a2', 8), b2: rifff('b2', 8) },
      playedBars: { a2: 16, b2: 16 },
      stretch: { a2: true, b2: true },
      channelOf: { a2: 'a', b2: 'b' },
      channelOrder: ['a', 'b']
    }
    const { actions } = buildCoachTensionActions(state, section, 'swell', ids)
    expect(actions.map((a) => (a.type === 'SET_GROUP_AUTOMATION' ? a.groupId : a.type))).toEqual([
      'a2',
      'b2'
    ])
  })

  it('leaves clips outside the section alone', () => {
    // The section runs bars 8..24. A clip at bar 24 belongs to whatever
    // comes next and must not be swept along with this one.
    const state: AppState = {
      ...placed(),
      rifffs: { a: rifff('a', 8), b: rifff('b', 8), c: rifff('c', 24) },
      playedBars: { a: 16, b: 16, c: 16 },
      stretch: { a: true, b: true, c: true },
      channelOf: { a: 'a', b: 'b', c: 'c' },
      channelOrder: ['a', 'b', 'c']
    }
    const { actions } = buildCoachTensionActions(state, section, 'swell', ids)
    expect(actions.map((a) => (a.type === 'SET_GROUP_AUTOMATION' ? a.groupId : a.type))).toEqual([
      'a',
      'b'
    ])
  })

  it('writes one curve per ROW, not one per run, when a stem leaves and comes back', () => {
    // A stem switched off mid-section and back on is two clips on ONE row.
    // The curve spans the section once, so it goes on the clip that opens
    // the row -- the same clip placedGroupIds used to name.
    const state: AppState = {
      ...placed(),
      rifffs: { a: rifff('a', 8), a3: rifff('a3', 16), b: rifff('b', 8) },
      playedBars: { a: 4, a3: 8, b: 16 },
      stretch: { a: true, a3: true, b: true },
      channelOf: { a: 'a', a3: 'a', b: 'b' },
      channelOrder: ['a', 'b']
    }
    const { actions } = buildCoachTensionActions(state, section, 'swell', ids)
    expect(actions.map((a) => (a.type === 'SET_GROUP_AUTOMATION' ? a.groupId : a.type))).toEqual([
      'a',
      'b'
    ])
  })
})

describe('coachTensionHasMaterial', () => {
  it('is true while the section still has clips in it', () => {
    expect(coachTensionHasMaterial(placed(), section, 'swell')).toBe(true)
  })

  it('is false for a curve when the section has been emptied', () => {
    expect(coachTensionHasMaterial({ ...placed(), rifffs: {} }, section, 'filter-sweep')).toBe(
      false
    )
  })

  it('is true for a riser either way -- a riser is its own material', () => {
    expect(coachTensionHasMaterial({ ...placed(), rifffs: {} }, section, 'riser')).toBe(true)
  })
})

describe('buildCoachTensionActions -- the riser', () => {
  it('drops one riser ending on the join, as long as the bars leading in', () => {
    const { actions, riserId } = buildCoachTensionActions(placed(), section, 'riser', ids)
    expect(riserId).toBe('riser-1')
    expect(actions).toHaveLength(1)
    const [action] = actions
    expect(action.type).toBe('ADD_RISER')
    if (action.type === 'ADD_RISER') {
      expect(action.riser.startBar).toBe(8)
      expect(action.riser.lengthBars).toBe(16)
      expect(action.riser.channelId).toBe('channel-new')
      // An ORDINARY riser: the same defaults createRiser gives the
      // right-click menu's own "add riser here".
      const byHand = createRiser({ id: 'x', channelId: 'y', startBar: 8, lengthBars: 16 })
      expect(action.riser.startCutoffValue).toBe(byHand.startCutoffValue)
      expect(action.riser.endCutoffValue).toBe(byHand.endCutoffValue)
      expect(action.riser.level).toBe(byHand.level)
      expect(action.riser.curve).toEqual(byHand.curve)
    }
  })

  it('really lands on the timeline when the reducer runs it', () => {
    const state = placed()
    const { actions } = buildCoachTensionActions(state, section, 'riser', ids)
    const after = actions.reduce(reducer, state)
    expect(after.risers['riser-1']?.channelId).toBe('channel-new')
    expect(after.channelOrder).toContain('channel-new')
  })

  it('lands unnamed, so the reducer numbers it like any hand-placed riser', () => {
    const { actions } = buildCoachTensionActions(placed(), section, 'riser', ids)
    const [action] = actions
    if (action.type !== 'ADD_RISER') throw new Error('expected ADD_RISER')
    expect(action.riser.name).toBe('')
    const after = actions.reduce(reducer, placed())
    expect(after.risers['riser-1'].name).toBe('riser 1')
  })
})

describe('buildCoachTensionRemovalActions', () => {
  it('clears the parameter on every clip -- the same thing right-clicking a lane does', () => {
    const actions = buildCoachTensionRemovalActions(placed(), section, 'swell', null)
    expect(actions).toEqual([
      { type: 'SET_GROUP_AUTOMATION', groupId: 'a', param: 'volume', points: [] },
      { type: 'SET_GROUP_AUTOMATION', groupId: 'b', param: 'volume', points: [] }
    ])
  })

  it('removes exactly the riser the flow placed', () => {
    expect(buildCoachTensionRemovalActions(placed(), section, 'riser', 'riser-1')).toEqual([
      { type: 'REMOVE_RISER', id: 'riser-1' }
    ])
  })

  it('removes nothing when there is no riser id on record', () => {
    expect(buildCoachTensionRemovalActions(placed(), section, 'riser', null)).toEqual([])
  })
})

/**
 * The bug this whole read path was rewritten for, end to end and in the
 * user's own order: build the map, shape a column on it (which is the ENTIRE
 * point of the walk that comes before the tension pass), then press one of
 * the tension offers.
 *
 * Reading section.placedGroupIds, every one of those cell edits orphaned a
 * row: the offer built zero actions, SssketchyTensionPanel's `if
 * (built.actions.length === 0) return` swallowed the click, and the
 * COACH_APPLY_TENSION that would have lit the toggle and thickened the map's
 * seam never went out either. "not sure if clicking one of these choices
 * works... no visual confirmation or change to the grid" (Elling,
 * 2026-09-23).
 */
describe('the tension pass after the map has been edited', () => {
  const PHRASE_BARS = 4

  function snapshot(path: string): CoachStemSnapshot {
    return { path, name: path, author: 'e', type: 'fx', durationSec: 4, barLength: 4 }
  }

  function mapState(): AppState {
    const climax = lockClimaxFromArrangeRoles(
      [
        { stem: snapshot('/kick.wav'), role: 'drums', gain: 1 },
        { stem: snapshot('/bass.wav'), role: 'bass', gain: 1 },
        { stem: snapshot('/hook.wav'), role: 'lead', gain: 1 }
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
    const source: Rifff = {
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
    const before: AppState = {
      ...initialState,
      bpm: 120,
      coach,
      rifffs: { src: source },
      channelOf: { src: 'src' },
      channelOrder: ['src']
    }
    const built = buildCoachMapActions(before, coach, sections)
    return [
      ...built.actions,
      { type: 'COACH_RECORD_MAP_PLACEMENT' as const, placedGroupIds: built.placedGroupIds }
    ].reduce(reducer, before)
  }

  /** The opening cell of every row in a section switched off and straight
   * back on -- an ordinary minute of the walk that comes BEFORE this step,
   * and enough to give every row in the column a new groupId. */
  function shapeColumn(state: AppState, sectionIndex: number): AppState {
    let next = state
    for (const path of ['/kick.wav', '/bass.wav', '/hook.wav']) {
      for (const on of [false, true]) {
        const coach = next.coach
        if (coach === null) continue
        const row = coachMapRows(next).find((candidate) => candidate.path === path)
        const target = coach.sections[sectionIndex]
        if (row === undefined || coach.lockedClimax === null) continue
        const plan = planCellToggle({
          clips: row.clips,
          section: target,
          phraseBars: PHRASE_BARS,
          passIndex: 0,
          on
        })
        next = buildCellToggleActions(
          next,
          row,
          target,
          plan,
          coach.lockedClimax,
          PHRASE_BARS
        ).reduce(reducer, next)
      }
    }
    return next
  }

  it('still has something to write to after the column has been shaped', () => {
    const state = shapeColumn(mapState(), 1)
    const coach = state.coach
    if (coach === null) throw new Error('expected a flow')
    const [boundary] = coachBoundaries(coach)
    expect(boundary.fromName).toBe('verse')
    const built = buildCoachTensionActions(
      state,
      coach.sections[boundary.index],
      'filter-sweep',
      ids
    )
    // One per row the verse really has on it -- three stems, three rows.
    expect(built.actions).toHaveLength(3)
  })

  it('records the toggle, so the panel lights up and the map thickens the seam', () => {
    const state = shapeColumn(mapState(), 1)
    const coach = state.coach
    if (coach === null) throw new Error('expected a flow')
    const [boundary] = coachBoundaries(coach)
    const built = buildCoachTensionActions(state, coach.sections[boundary.index], 'swell', ids)
    // Exactly what SssketchyTensionPanel.toggle dispatches, through the real
    // history reducer -- one BATCH, and therefore one undo step.
    const after = historyReducer(createHistoryState(state), {
      type: 'BATCH',
      actions: [
        ...built.actions,
        {
          type: 'COACH_APPLY_TENSION',
          sectionIndex: boundary.index,
          kind: 'swell',
          riserId: built.riserId
        }
      ]
    }).present
    expect(tensionIsApplied(after.coach?.tension ?? [], boundary.index, 'swell')).toBe(true)
    expect(Object.keys(after.stemAutomation).length).toBeGreaterThan(0)
  })
})
