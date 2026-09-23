import { useCallback, useMemo, useState } from 'react'
import {
  distinctPlacedBarLengths,
  unguidedMapColumns,
  unguidedPhraseBars,
  type ArrangementMapColumn
} from '@shared/arrangementMapColumns'
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
import { coachSectionBoundaries, coachTensionDef } from '@shared/coachTension'
import { buildCellToggleActions, buildMapRebuildActions } from '../state/coachMapPlacement'
import { coachMapRows, type CoachMapRow } from '../state/coachMapRows'
import { coachMapRowLabels, mapRowsNeedCategorising } from '../state/coachMapRowLabels'
import { useConfirmedStemRoles } from '../state/useConfirmedStemRoles'
import { markManualSeek } from '../state/manualSeek'
import { placedTimelineSpanBars } from '../state/selectors'
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
 * sections where a builder made some and plain one-phrase blocks where
 * nobody did, and a column subdivides into one cell per pass (spec, "The
 * map").
 *
 * IT WORKS ON ANY ARRANGEMENT. A guided map maps one column off each
 * CoachSection; an unguided one gets ceil(totalBars / phraseBars) UNNAMED
 * columns of one pass each from @shared/arrangementMapColumns -- and that
 * module's own doc comment says at length why nothing here infers where a
 * section begins. The three decorations that need a walk (walkIndex,
 * tension, phraseReading) are already empty without a coach, so an unguided
 * map draws no dividers, no join labels and no dimming without a single
 * `if (!guided)` around them. sssketchy says nothing here: he walks
 * sections, and there are none.
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
 * Which rows can be EDITED is decided by coachMapRows: a row whose material
 * names a single stem knows what belongs on it, so a cell can put one back;
 * a 'riser' row and a mixed row do not, so they report and do not act. A
 * riser also has no SoundType, so its cells are monochrome -- see
 * ArrangementMapCell.
 */
export function ArrangementMap({
  onWhatIsThis
}: {
  /** Opens the surface that answers "what is this stem" -- Tidy Up, on this
   * sketch's stems. Part 1's whole join to part 2 (spec). */
  onWhatIsThis: () => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  const sections = useMemo(() => coach?.sections ?? [], [coach])
  const guided = sections.length > 0
  const walkIndex = coach?.walkIndex ?? null

  // The loops actually placed, which is where an unguided map gets both its
  // phrase and the lengths its button row may offer -- facts about the
  // arrangement rather than guesses about it.
  const placedLoops = useMemo(
    () =>
      Object.values(state.rifffs)
        .filter((rifff) => rifff.startBar !== undefined)
        .map((rifff) => ({ startBar: rifff.startBar ?? 0, barLength: rifff.barLength })),
    [state.rifffs]
  )

  /**
   * An unguided map's phrase, held HERE rather than dispatched.
   *
   * The reducer's COACH_SET_PHRASE case opens `if (state.coach === null)
   * return state` -- so on an arrangement nobody ran the wizard on, which is
   * the entire population this branch exists for, dispatching it does
   * nothing at all. Checked before writing this, as the plan required.
   *
   * Local state is also the right shape on its own merits: this is a
   * view-level grid preference, the same class of thing as state.mode. It is
   * not an undo step (re-sizing the squares changes no clip) and it does not
   * belong on disk.
   */
  const [unguidedPhraseChoice, setUnguidedPhraseChoice] = useState<number | null>(null)

  // The user's own answer wins wherever there is one -- on a guided map his
  // answer to the measurement, on an unguided one whatever he last clicked
  // in the button row below. Otherwise: the earliest placed rifff's own bar
  // length. A rifff IS a loop, so its barLength is the nominal phrase
  // without measuring anything.
  const phraseBars = useMemo((): number => {
    if (guided) return coach?.phrase?.bars ?? coach?.lockedClimax?.barLength ?? 1
    return unguidedPhraseChoice ?? coach?.phrase?.bars ?? unguidedPhraseBars(placedLoops) ?? 1
  }, [coach, guided, placedLoops, unguidedPhraseChoice])

  const columns = useMemo((): ArrangementMapColumn[] => {
    if (guided) {
      return sections.map((section) => ({
        id: section.id,
        name: section.name,
        startBar: section.startBar,
        passes: section.passes
      }))
    }
    return unguidedMapColumns(placedTimelineSpanBars(state), phraseBars)
  }, [guided, sections, state, phraseBars])

  const rows = useMemo(() => coachMapRows(state), [state])
  // The first link of the label chain, and the only one the renderer has to
  // go and fetch: what somebody already said these stems are. The rest of
  // the chain (climax role -> stem name -> path) is already on the row.
  const rowPaths = useMemo(
    () => rows.map((row) => row.path).filter((path): path is string => path !== null),
    [rows]
  )
  const confirmedRoles = useConfirmedStemRoles(rowPaths)
  const labels = useMemo(() => coachMapRowLabels(rows, confirmedRoles), [rows, confirmedRoles])
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
   * What is switched on at each join, in words, for the column header.
   *
   * A thicker rule says SOMETHING is there; it cannot say what. Reported
   * directly -- "might be good to include indication of seams tweaks" --
   * against a build where nothing showed at all (the tension pass was
   * writing nothing; see coachTensionApply.ts). The header column IS the
   * outgoing section's box and its right edge IS the join, so a label here
   * needs no extra geometry. One move is named; several are counted, since
   * the column is narrow and ellipsised.
   */
  const appliedLabelAt = useMemo(() => {
    const byIndex = new Map<number, string>()
    for (const entry of coach?.tension ?? []) {
      const label = coachTensionDef(entry.kind).label
      const seen = byIndex.get(entry.sectionIndex)
      byIndex.set(entry.sectionIndex, seen === undefined ? label : 'several moves')
    }
    return byIndex
  }, [coach])
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
    const geometry: CoachMapColumn[] = []
    const styles: React.CSSProperties[] = []
    columns.forEach((column, index) => {
      const boundary = boundaryAfter.has(index)
      const applied = boundary && appliedAt.has(index)
      // A join that has something switched on is drawn thicker. Monochrome
      // either way -- a join is structure, not audio information.
      // 3px, not 2: at 2px against a 1px inactive rule, inside an 8px gap,
      // nobody noticed a join had anything on it -- reported directly
      // ("no visual confirmation or change to the grid"). --ra-text is
      // already this component's own "this one is live" value (the walked
      // section's name uses it), so a thicker join introduces no new colour.
      const dividerWidth = !boundary ? 0 : applied ? 3 : 1
      const paddingRight = boundary ? SECTION_GAP : 0
      const marginRight = boundary ? SECTION_GAP + 2 : SECTION_GAP
      geometry.push({
        startBar: column.startBar,
        bars: sectionBars(column.passes, phraseBars),
        passes: column.passes,
        trailing: paddingRight + dividerWidth + marginRight
      })
      styles.push({
        flex: 'none',
        boxSizing: 'content-box',
        width: coachMapColumnWidth(column.passes, MAP_CELL_WIDTH, MAP_CELL_GAP),
        paddingRight,
        marginRight,
        borderRight:
          dividerWidth === 0
            ? undefined
            : applied
              ? '3px solid var(--ra-text)'
              : '1px solid var(--ra-border-strong)'
      })
    })
    return { spans: coachMapSpans(geometry, MAP_CELL_WIDTH, MAP_CELL_GAP), styles }
  }, [appliedAt, boundaryAfter, phraseBars, columns])

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
  // (spec).
  //
  // Guided: the app's own measurement, offered once, with the silence rule
  // (coachPhrase.ts) so a loop that really does take all its bars to say its
  // piece is never nagged about. Unguided: the distinct bar lengths ACTUALLY
  // PRESENT -- facts about the arrangement, which is the property that makes
  // offering them allowed at all. Shown only when there is more than one to
  // choose from.
  const reading = coach?.phraseReading ?? null
  const phraseOptions: readonly CoachPhrase[] = guided
    ? reading !== null && loopPhraseIsWorthSaying(reading)
      ? phraseAnswerOptions(reading)
      : []
    : distinctPlacedBarLengths(placedLoops).map((bars) => ({ bars, source: 'nominal' as const }))

  const changePhrase = useCallback(
    (option: CoachPhrase): void => {
      if (option.bars === phraseBars) return
      if (!guided) {
        // Nothing to rebuild: an unguided map's columns are computed from
        // this number every render, so recording the answer IS the re-size.
        // No clip moves, so this is not an undo step either.
        setUnguidedPhraseChoice(option.bars)
        return
      }
      if (coach === null) return
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
    [coach, dispatch, guided, phraseBars, state]
  )

  const toggle = useCallback(
    (row: CoachMapRow, column: ArrangementMapColumn, passIndex: number, on: boolean): void => {
      if (row.source === null) return
      const plan = planCellToggle({ clips: row.clips, section: column, phraseBars, passIndex, on })
      const actions = buildCellToggleActions(state, row, column, plan, phraseBars)
      if (actions.length === 0) return
      // ONE batch, so one cell is one undo step -- and so the map's own
      // edits are the same kind of thing as every other edit in the app.
      dispatch({ type: 'BATCH', actions })
    },
    [dispatch, phraseBars, state]
  )

  if (columns.length === 0) {
    return (
      <div style={{ padding: 'var(--ra-s-7)', fontSize: 11, color: 'var(--ra-text-3)' }}>
        nothing on the timeline yet.
      </div>
    )
  }

  return (
    <div style={{ padding: 'var(--ra-s-5)', overflowX: 'auto' }}>
      {/* Offered only while there is something to ask about: a row holding a
          stem nobody has named. It is A BUTTON AND NOTHING ELSE -- sssketchy
          does not mention it, does not nudge toward it and gains no line,
          because he walks sections and an unguided map has none (spec,
          "sssketchy says nothing here"). */}
      {mapRowsNeedCategorising(rows, confirmedRoles) && (
        <div style={{ display: 'flex', marginBottom: 'var(--ra-s-5)' }}>
          <button
            type="button"
            onClick={onWhatIsThis}
            data-tooltip="name these stems"
            style={{
              height: 20,
              borderRadius: 0,
              padding: '0 8px',
              fontSize: 10,
              fontFamily: 'inherit',
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)',
              cursor: 'pointer'
            }}
          >
            what is this?
          </button>
        </div>
      )}
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
              data-tooltip="re-size the map"
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
          the rest stepped back -- and NO TEXT AT ALL on an unguided map,
          where a column has no name (spec: "the header carries no text at
          all"; the per-column tooltip already says which bar it starts at).
          No colour -- a section is structure, not audio information.

          This strip is also the map's ruler: click or drag along it to move
          the playhead. It is the natural place for it -- it is where the
          arranger puts the same gesture, and it is the one horizontal band
          on the map that does not already mean something else. */}
        <div
          onMouseDown={handleScrubStart}
          data-tooltip="move the playhead"
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
          {columns.map((column, index) => (
            <div
              key={column.id}
              style={{
                ...layout.styles[index],
                fontSize: 10,
                lineHeight: 'var(--ra-lh-tight)',
                color: walkIndex === index ? 'var(--ra-text)' : 'var(--ra-text-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              data-tooltip={
                appliedLabelAt.has(index)
                  ? `${column.passes} x ${phraseBars} bars · ${appliedLabelAt.get(index)}`
                  : `${column.passes} x ${phraseBars} bars, from bar ${column.startBar}`
              }
            >
              {column.name}
              {appliedLabelAt.has(index) && (
                <span style={{ color: 'var(--ra-text-2)' }}> · {appliedLabelAt.get(index)}</span>
              )}
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
                {labels.get(row.channelId) ?? row.label}
              </span>
            </div>

            {columns.map((column, columnIndex) => {
              const passes = readRowPasses(row.clips, column, phraseBars)
              return (
                <div
                  key={column.id}
                  style={{
                    ...layout.styles[columnIndex],
                    display: 'flex',
                    gap: MAP_CELL_GAP,
                    background: walkIndex === columnIndex ? 'var(--ra-bg-row-sub)' : undefined
                  }}
                >
                  {passes.map((on, passIndex) => (
                    <ArrangementMapCell
                      key={passIndex}
                      on={on}
                      locked={passIsLocked(row.clips, column, phraseBars, passIndex)}
                      editable={row.source !== null}
                      soundType={row.soundType}
                      dimmed={walkIndex !== null && walkIndex !== columnIndex}
                      label={`${labels.get(row.channelId) ?? row.label} - ${
                        column.name ?? `bar ${column.startBar}`
                      } - pass ${passIndex + 1} of ${column.passes}`}
                      onToggle={(): void => toggle(row, column, passIndex, !on)}
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
          ? ' grey rows are risers and rows holding more than one stem -- edit those on the timeline.'
          : ''}
      </div>
      <div style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
        total{' '}
        {sectionBars(
          columns.reduce((sum, column) => sum + column.passes, 0),
          phraseBars
        )}{' '}
        bars
      </div>
    </div>
  )
}
