import { useCallback, useMemo } from 'react'
import { passIsLocked, planCellToggle } from '@shared/coachMapEdit'
import { readRowPasses } from '@shared/coachMapRead'
import { sectionBars } from '@shared/coachPasses'
import { loopPhraseIsWorthSaying, phraseAnswerOptions, type CoachPhrase } from '@shared/coachPhrase'
import { coachSectionBoundaries } from '@shared/coachTension'
import type { CoachSection } from '@shared/coachSections'
import { buildCellToggleActions, buildMapRebuildActions } from '../state/coachMapPlacement'
import { coachMapRows, type CoachMapRow } from '../state/coachMapRows'
import { useAppState, useDispatch } from '../state/StoreContext'
import { typeColorVar } from '../theme/typeColor'
import {
  ArrangementMapCell,
  MAP_CELL_GAP,
  MAP_CELL_HEIGHT,
  MAP_CELL_WIDTH
} from './ArrangementMapCell'

const ROW_HEADER_WIDTH = 168
const SECTION_GAP = 8

/**
 * The arrangement map: rows are the arranger's own channel rows, columns are
 * sections, and a section subdivides into one cell per pass (spec, "The
 * map").
 *
 * THE THING TO UNDERSTAND BEFORE CHANGING ANYTHING HERE: **this component
 * holds no state and owns no grid.** Every cell it draws is read out of the
 * live timeline (coachMapRows + readRowPasses) and every click dispatches
 * ordinary clip actions (planCellToggle + buildCellToggleActions). There is
 * no commit step, nothing to keep in sync, and undo works because undo
 * already works on clips. If you find yourself adding a useState for the
 * grid, or reading CoachSection.cells here, stop and read
 * src/shared/coachMapRead.ts's own doc comment.
 *
 * Rows are rendered in coachMapRows' own order, which is channelsInOrder --
 * the order the ARRANGER draws them. Deliberately not re-sorted by
 * coachMapRowOrder: the build lays its lanes out in that order already, so
 * the two agree by construction, and re-sorting here would paper over a real
 * divergence the map exists to show.
 *
 * Which rows can be EDITED is decided by coachMapRows: a 'stem' row knows
 * which stem belongs on it, so a cell can put one back; a 'riser' row and an
 * 'other' row do not, so they report and do not act. A riser also has no
 * SoundType, so its cells are monochrome -- see ArrangementMapCell.
 */
export function ArrangementMap(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  const sections = useMemo(() => coach?.sections ?? [], [coach])
  const climax = coach?.lockedClimax ?? null
  const phraseBars = coach?.phrase?.bars ?? climax?.barLength ?? 1
  const walkIndex = coach?.walkIndex ?? null

  const rows = useMemo(() => coachMapRows(state), [state])
  // Derived, never stored: rename or resize a section and the joins follow.
  // The same list phase three's own panel reads, so the map and the tension
  // pass can never disagree about where a join is.
  const boundaries = useMemo(
    () => coachSectionBoundaries(sections, phraseBars),
    [sections, phraseBars]
  )
  const boundaryAfter = useMemo(
    () => new Set(boundaries.map((boundary) => boundary.index)),
    [boundaries]
  )
  // Which joins actually have something switched on -- the one fact the map
  // can report about a seam. Monochrome and thicker, never a colour: a join
  // is structure, not audio information. The toggles themselves stay in the
  // bubble (SssketchyTensionPanel), because a second set here would be two
  // ways to do one thing.
  const appliedAt = useMemo(
    () => new Set((coach?.tension ?? []).map((entry) => entry.sectionIndex)),
    [coach]
  )
  const dividerFor = useCallback(
    (index: number): string | undefined => {
      if (!boundaryAfter.has(index)) return undefined
      return appliedAt.has(index)
        ? '2px solid var(--ra-text-2)'
        : '1px solid var(--ra-border-strong)'
    },
    [appliedAt, boundaryAfter]
  )

  // "He can change it afterwards; the map re-sizes, it does not rebuild"
  // (spec). Offered only when there is a measurement worth offering -- the
  // same silence rule the setup screen follows, so a loop that really does
  // take all its bars to say its piece is never nagged about.
  const reading = coach?.phraseReading ?? null
  const phraseOptions: readonly CoachPhrase[] =
    reading !== null && loopPhraseIsWorthSaying(reading) ? phraseAnswerOptions(reading) : []

  const changePhrase = useCallback(
    (option: CoachPhrase): void => {
      if (coach === null || option.bars === phraseBars) return
      const built = buildMapRebuildActions(state, coach, option.bars)
      dispatch({
        type: 'BATCH',
        actions: [
          // COACH_SET_PHRASE re-sizes the sections in the reducer with the
          // same resizeCoachMapToPhrase the builder just used, from the same
          // inputs, so the two cannot disagree.
          { type: 'COACH_SET_PHRASE', phrase: option },
          ...built.actions,
          { type: 'COACH_RECORD_MAP_PLACEMENT', placedGroupIds: built.placedGroupIds }
        ]
      })
    },
    [coach, dispatch, phraseBars, state]
  )

  const toggle = useCallback(
    (row: CoachMapRow, section: CoachSection, passIndex: number, on: boolean): void => {
      if (climax === null || row.path === null) return
      const plan = planCellToggle({ clips: row.clips, section, phraseBars, passIndex, on })
      const actions = buildCellToggleActions(state, row, section, plan, climax, phraseBars)
      if (actions.length === 0) return
      // ONE batch, so one cell is one undo step -- and so the map's own
      // edits are the same kind of thing as every other edit in the app.
      dispatch({ type: 'BATCH', actions })
    },
    [climax, dispatch, phraseBars, state]
  )

  if (sections.length === 0) {
    return (
      <div style={{ padding: 'var(--ra-s-7)', fontSize: 11, color: 'var(--ra-text-3)' }}>
        no map yet. run the auto-arranger to build one.
      </div>
    )
  }

  return (
    <div style={{ padding: 'var(--ra-s-5)', overflowX: 'auto' }}>
      {phraseOptions.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--ra-s-2)',
            marginBottom: 'var(--ra-s-5)',
            fontSize: 10,
            color: 'var(--ra-text-3)'
          }}
        >
          <span>the phrase</span>
          {phraseOptions.map((option) => (
            <button
              key={`${option.bars}-${option.source}`}
              type="button"
              onClick={(): void => changePhrase(option)}
              data-tooltip="re-size the map to this phrase. the squares move, the song does not."
              style={{
                height: 20,
                borderRadius: 0,
                padding: '0 8px',
                fontSize: 10,
                border: `1px solid ${
                  option.bars === phraseBars ? 'var(--ra-stretch-on)' : 'var(--ra-border)'
                }`,
                background:
                  option.bars === phraseBars
                    ? 'var(--ra-stretch-on-bg)'
                    : 'var(--ra-bg-row-active)',
                color: option.bars === phraseBars ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
                cursor: 'pointer'
              }}
            >
              {option.bars} bars
            </button>
          ))}
        </div>
      )}
      {/* Column headers: the section names, with the walked one bright and
          the rest stepped back. No colour -- a section is structure, not
          audio information. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 'var(--ra-s-2)' }}>
        <div style={{ width: ROW_HEADER_WIDTH, flex: 'none' }} />
        {sections.map((section, index) => (
          <div
            key={section.id}
            style={{
              flex: 'none',
              marginRight: boundaryAfter.has(index) ? SECTION_GAP + 2 : SECTION_GAP,
              borderRight: dividerFor(index),
              paddingRight: boundaryAfter.has(index) ? SECTION_GAP : 0,
              width: section.passes * (MAP_CELL_WIDTH + MAP_CELL_GAP),
              fontSize: 10,
              lineHeight: 'var(--ra-lh-tight)',
              color: walkIndex === index ? 'var(--ra-text)' : 'var(--ra-text-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            data-tooltip={`${section.passes} x ${phraseBars} bars, from bar ${section.startBar}`}
          >
            {section.name}
          </div>
        ))}
      </div>

      {rows.map((row) => (
        <div
          key={row.channelId}
          style={{
            display: 'flex',
            alignItems: 'center',
            minHeight: MAP_CELL_HEIGHT,
            marginBottom: MAP_CELL_GAP
          }}
        >
          <div
            style={{
              width: ROW_HEADER_WIDTH,
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--ra-s-2)',
              fontSize: 10,
              color: row.kind === 'stem' ? 'var(--ra-text-2)' : 'var(--ra-text-3)',
              overflow: 'hidden'
            }}
          >
            {/* The one colour in a row header, and the legitimate one: a
                stem's own identity. A riser has no sound type, so it gets no
                swatch rather than a borrowed hue. */}
            <span
              style={{
                width: 6,
                height: 6,
                flex: 'none',
                background:
                  row.soundType === null ? 'var(--ra-border-strong)' : typeColorVar(row.soundType)
              }}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.label}
            </span>
          </div>

          {sections.map((section, sectionIndex) => {
            const passes = readRowPasses(row.clips, section, phraseBars)
            return (
              <div
                key={section.id}
                style={{
                  display: 'flex',
                  gap: MAP_CELL_GAP,
                  flex: 'none',
                  marginRight: boundaryAfter.has(sectionIndex) ? SECTION_GAP + 2 : SECTION_GAP,
                  borderRight: dividerFor(sectionIndex),
                  paddingRight: boundaryAfter.has(sectionIndex) ? SECTION_GAP : 0,
                  background: walkIndex === sectionIndex ? 'var(--ra-bg-row-sub)' : undefined
                }}
              >
                {passes.map((on, passIndex) => (
                  <ArrangementMapCell
                    key={passIndex}
                    on={on}
                    locked={passIsLocked(row.clips, section, phraseBars, passIndex)}
                    editable={row.kind === 'stem'}
                    soundType={row.soundType}
                    dimmed={walkIndex !== null && walkIndex !== sectionIndex}
                    label={`${row.label} - ${section.name} - pass ${passIndex + 1} of ${
                      section.passes
                    }`}
                    onToggle={(): void => toggle(row, section, passIndex, !on)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      ))}

      <div style={{ marginTop: 'var(--ra-s-6)', fontSize: 9, color: 'var(--ra-text-3)' }}>
        every square is ordinary clips. one undo takes any of it back.
        {rows.some((row) => row.kind !== 'stem')
          ? ' grey rows are risers and clips the map did not lay out -- edit those on the timeline.'
          : ''}
      </div>
      <div style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
        total{' '}
        {sectionBars(
          sections.reduce((sum, section) => sum + section.passes, 0),
          phraseBars
        )}{' '}
        bars
      </div>
    </div>
  )
}
