import { useCallback, useMemo } from 'react'
import {
  coachMapColumnWidth,
  coachMapSpans,
  coachMapXToBar,
  type CoachMapColumn,
  type CoachMapSpan
} from '@shared/coachMapGeometry'
import { passIsLocked, planCellToggle } from '@shared/coachMapEdit'
import { readRowPasses } from '@shared/coachMapRead'
import { sectionBars } from '@shared/coachPasses'
import { loopPhraseIsWorthSaying, phraseAnswerOptions, type CoachPhrase } from '@shared/coachPhrase'
import { coachSectionBoundaries } from '@shared/coachTension'
import type { CoachSection } from '@shared/coachSections'
import { buildCellToggleActions, buildMapRebuildActions } from '../state/coachMapPlacement'
import { coachMapRows, type CoachMapRow } from '../state/coachMapRows'
import { markManualSeek } from '../state/manualSeek'
import { useAppState, useDispatch, usePlaying } from '../state/StoreContext'
import { typeColorVar } from '../theme/typeColor'
import {
  ArrangementMapCell,
  MAP_CELL_GAP,
  MAP_CELL_HEIGHT,
  MAP_CELL_WIDTH
} from './ArrangementMapCell'
import { ArrangementMapPlayhead } from './ArrangementMapPlayhead'
import { startPointerDrag } from './dragUtils'

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
  /**
   * The map's own x-axis, worked out ONCE from what is about to be drawn
   * and then read by three things that have to agree: the header strip, the
   * cell rows, and the playhead drawn across both.
   *
   * `styles` is content-box on purpose. global.css puts border-box on
   * everything, so a column whose `width` also had to cover a divider and
   * its padding came out narrower than its own cells -- the section names
   * crept left of their squares, a little further after every boundary.
   * Saying content-box makes `width` mean the cells and nothing else, which
   * is the one measurement the geometry module accumulates.
   *
   * `spans` is that accumulation: src/shared/coachMapGeometry.ts turns each
   * column's cells-width and trailing gap into the bar range it covers, and
   * answers bar -> x and x -> bar over the result. Pure, and tested, because
   * the map's x-axis is not `bar * ppb` and getting it a pixel wrong is not
   * something anyone can see in a screenshot.
   */
  const layout = useMemo((): { spans: CoachMapSpan[]; styles: React.CSSProperties[] } => {
    const columns: CoachMapColumn[] = []
    const styles: React.CSSProperties[] = []
    sections.forEach((section, index) => {
      const boundary = boundaryAfter.has(index)
      const applied = boundary && appliedAt.has(index)
      // A join that has something switched on is drawn thicker. Monochrome
      // either way -- a join is structure, not audio information.
      const dividerWidth = !boundary ? 0 : applied ? 2 : 1
      const paddingRight = boundary ? SECTION_GAP : 0
      const marginRight = boundary ? SECTION_GAP + 2 : SECTION_GAP
      columns.push({
        startBar: section.startBar,
        bars: sectionBars(section.passes, phraseBars),
        passes: section.passes,
        trailing: paddingRight + dividerWidth + marginRight
      })
      styles.push({
        flex: 'none',
        boxSizing: 'content-box',
        width: coachMapColumnWidth(section.passes, MAP_CELL_WIDTH, MAP_CELL_GAP),
        paddingRight,
        marginRight,
        borderRight:
          dividerWidth === 0
            ? undefined
            : applied
              ? '2px solid var(--ra-text-2)'
              : '1px solid var(--ra-border-strong)'
      })
    })
    return { spans: coachMapSpans(columns, MAP_CELL_WIDTH, MAP_CELL_GAP), styles }
  }, [appliedAt, boundaryAfter, phraseBars, sections])

  const playing = usePlaying()

  // Seeking, in the ruler's exact order (Ruler.tsx is the original, and the
  // order is not arbitrary): the local position first so the line moves at
  // once, then -- only while the transport is actually moving --
  // markManualSeek() so the engine's next in-flight position tick does not
  // drag the line back for a frame, then the engine itself so the audio
  // really goes there. While stopped, pos alone is enough: enginePlay(pos)
  // reads it fresh at play-start.
  const seekToX = useCallback(
    (x: number): void => {
      const bar = coachMapXToBar(layout.spans, x)
      if (bar === null) return
      dispatch({ type: 'SET_POS', pos: bar })
      if (playing) {
        markManualSeek()
        void window.rifffApi.engineSetPosition(bar)
      }
    },
    [dispatch, layout, playing]
  )

  // The section-header strip is the rail, mirroring the arranger's ruler --
  // and deliberately NOT the cells, which already mean "put this stem in or
  // take it out" and must go on meaning only that. Nothing here touches a
  // cell's own click.
  const handleScrubStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return
      const rect = e.currentTarget.getBoundingClientRect()
      const startX = e.clientX - rect.left - ROW_HEADER_WIDTH
      // The row-header gutter is not part of the rail. A click there is a
      // click on nothing, not a seek to the top of the song.
      if (startX < 0) return
      seekToX(startX)
      startPointerDrag(e, (deltaX) => {
        seekToX(startX + deltaX)
      })
    },
    [seekToX]
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
      {/* Everything the playhead has to line up with lives inside this one
          positioned box: the rail and every row under it. */}
      <div style={{ position: 'relative' }}>
        {/* Column headers: the section names, with the walked one bright and
          the rest stepped back. No colour -- a section is structure, not
          audio information.

          This strip is also the map's ruler: click or drag along it to move
          the playhead. It is the natural place for it -- it is where the
          arranger puts the same gesture, and it is the one horizontal band
          on the map that does not already mean something else. */}
        <div
          onMouseDown={handleScrubStart}
          data-tooltip="click or drag along here to move the playhead"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            marginBottom: 'var(--ra-s-2)',
            paddingBottom: 'var(--ra-s-1)',
            borderBottom: '1px solid var(--ra-border)',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div style={{ width: ROW_HEADER_WIDTH, flex: 'none' }} />
          {sections.map((section, index) => (
            <div
              key={section.id}
              style={{
                ...layout.styles[index],
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
                    ...layout.styles[sectionIndex],
                    display: 'flex',
                    gap: MAP_CELL_GAP,
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

        {/* Last, so it draws over the cells rather than under them. Its own
            component because it reads the position, which arrives ~30 times
            a second -- see ArrangementMapPlayhead.tsx. */}
        <ArrangementMapPlayhead spans={layout.spans} left={ROW_HEADER_WIDTH} />
      </div>

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
