import { useCallback, useEffect } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { useCoachSectionPreview } from '../state/useCoachSectionPreview'
import { registerCoachSectionOp } from '../state/coachSectionBridge'
import { buildCoachSectionActions } from '../state/coachSectionPlacement'
import { typeColorVar } from '../theme/typeColor'
import type { CoachState } from '@shared/coach'
import {
  coachSectionTypeDef,
  nextSectionTypeSuggestions,
  type CoachSectionOp,
  type CoachSectionType
} from '@shared/coachSections'
import { cellIsOn } from '@shared/coachCells'
import { templateFallbackFor } from '@shared/coachMapTemplate'
import { COACH_SECTION_PASS_NUDGES } from '@shared/coachPasses'
import { COACH_LOOP_HOME_TYPE } from '@shared/coachShapes'
import { slotKindsLabel } from '@shared/discoverSlotKind'

const PANEL_WIDTH = 320

const buttonStyle: React.CSSProperties = {
  height: 20,
  borderRadius: 0,
  padding: '0 8px',
  fontSize: 10,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text-2)',
  cursor: 'pointer'
}

/** Bottom-RIGHT, where the bubble is bottom-left (anchored to the timeline's
 * own left edge in phase two), so the two never overlap. Ordinary anchored
 * layer: phase two happens on the timeline, not inside the riff library's
 * full-screen view. */
const panelStyle: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 12,
  width: PANEL_WIDTH,
  maxHeight: '60vh',
  overflowY: 'auto',
  background: 'var(--ra-bg-bar)',
  border: '1px solid var(--ra-border-strong)',
  borderRadius: 0,
  padding: 'var(--ra-s-6)',
  zIndex: 'var(--ra-z-anchored)',
  boxShadow: 'var(--ra-shadow-popover)'
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--ra-s-1)',
  marginTop: 'var(--ra-s-5)'
}

/**
 * The section surface: pick a section, carve it, put it down.
 *
 * THE RULE THIS COMPONENT RENDERS, AS OF 2026-09-23: **the draft arrives
 * PRE-FILLED from the template** (spec:
 * docs/superpowers/specs/2026-09-23-arrangement-map-design.md, "The map
 * arrives pre-filled, and says so"). This is the deliberate reversal of the
 * everything-on/user-subtracts rule this panel used to render. A checkbox is
 * therefore not "has the user dropped this" but "does this stem play in the
 * first pass" -- template answer unless the user overrode it (cellIsOn,
 * @shared/coachCells). The "drop the suggested ones" button went with the
 * old rule: the suggestion table is already applied, and a button that
 * applies it again says nothing.
 *
 * This panel is a WHOLE-STEM view of a per-pass model. A stem that arrives
 * halfway through the section still shows as one checkbox, reading pass 0,
 * and ticking it writes every pass. The map replaces this with the real
 * grid; nothing here is meant to be the final surface, and it is kept
 * working only so the branch stays coherent.
 *
 * There is no local state here at all, and no initialiser that could seed
 * one: the draft only ever changes through the dispatches below.
 *
 * Deliberately a separate component from SssketchyCoach's bubble rather than
 * more buttons inside it: the bubble carries one thought and four verbs
 * (spec), and a stem list with toggles is not a thought. They sit on
 * opposite bottom corners so they never overlap.
 *
 * WHICH HALF IT SHOWS is decided by whether there is a DRAFT, not purely by
 * the step id. The plan keyed it off the step alone, but the bubble's own
 * "next" button is always live: pressing it on p2-first walks the flow to
 * p2-section without ever opening a draft, and a step-only test would then
 * render an empty bordered box with no way out. Asking for the draft makes
 * that land on the type chooser instead, which is the only thing that can
 * usefully be offered when there is nothing being carved.
 */

/** Which section type the user's own loop IS. 'drop' until he answers,
 * which is COACH_LOOP_HOME_TYPE's own default and the place the method puts
 * unattributed material. The home section keeps every stem in every pass,
 * so this is what decides whether a checkbox starts ticked. */
function homeTypeFor(coach: CoachState): CoachSectionType {
  return coach.loopIs === null ? 'drop' : COACH_LOOP_HOME_TYPE[coach.loopIs]
}

/** The phrase length section sizing reads -- the USER'S answer, never a
 * measurement (@shared/coachPhrase).
 *
 * One pass is the fallback, matching coachPhase2's startCoachSection,
 * coachTensionApply and the load-time migration in coach.ts. They have to
 * agree: a section's stored `passes` is computed against this number, and a
 * panel that placed clips against a different one would put the tension
 * pass's risers at bars the clips are not on. */
function phraseBarsFor(coach: CoachState): number {
  return coach.phrase?.bars ?? 1
}

export function SssketchySectionPanel(): React.JSX.Element | null {
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  const { previewing, previewSection, stopPreview } = useCoachSectionPreview()

  const climax = coach?.lockedClimax ?? null
  const draft = coach?.draftSection ?? null
  const stepId = coach?.stepId

  const handlePlace = useCallback((): void => {
    if (coach === null || climax === null || draft === null) return
    const built = buildCoachSectionActions(
      state,
      climax,
      draft,
      coach.sections,
      homeTypeFor(coach),
      phraseBarsFor(coach)
    )
    stopPreview()
    // ONE batch: the clips and the flow's record of the section become one
    // undo step -- "one undo step per section" (spec). See history.ts.
    dispatch({
      type: 'BATCH',
      actions: [
        ...built.actions,
        {
          type: 'COACH_PLACE_SECTION',
          now: Date.now(),
          startBar: built.startBar,
          placedGroupIds: built.placedGroupIds
        }
      ]
    })
  }, [climax, coach, dispatch, draft, state, stopPreview])

  const runOp = useCallback(
    (op: CoachSectionOp): void => {
      if (op === 'preview') {
        if (previewing) stopPreview()
        else if (coach !== null && climax !== null && draft !== null) {
          void previewSection(climax, draft, homeTypeFor(coach), phraseBarsFor(coach))
        }
        return
      }
      handlePlace()
    },
    [climax, coach, draft, handlePlace, previewSection, previewing, stopPreview]
  )

  // A hook rather than a plain function declared further down next to its
  // one call site: react-hooks/purity reads a bare Date.now() in a
  // component body as a render-time impurity, and cannot tell an event
  // handler apart from render code unless it is wrapped.
  const startSection = useCallback(
    (type: CoachSectionType): void => {
      stopPreview()
      dispatch({ type: 'COACH_START_SECTION', now: Date.now(), sectionType: type })
    },
    [dispatch, stopPreview]
  )

  // The bubble's "do it for me"/"stuck?" moves reach these same three
  // buttons through the bridge -- see coachSectionBridge.ts.
  useEffect(() => registerCoachSectionOp(runOp), [runOp])

  if (coach === null || coach.status !== 'active' || climax === null) return null
  if (stepId !== 'p2-first' && stepId !== 'p2-section' && stepId !== 'p2-next') return null

  // Nothing is being carved: ask which section comes next. Reads the placed
  // sections rather than the step id for the same reason the heading does --
  // "first" and "next" is a fact about the arrangement, not about which of
  // the two question steps the flow happens to be sitting on.
  if (draft === null || stepId !== 'p2-section') {
    const started = coach.sections.length > 0
    return (
      <div style={panelStyle}>
        <div className="ra-eyebrow">{started ? 'what comes next' : 'what comes first'}</div>
        <div style={rowStyle}>
          {nextSectionTypeSuggestions(coach.sections).map((type) => (
            <button key={type} type="button" onClick={() => startSection(type)} style={buttonStyle}>
              {coachSectionTypeDef(type).label}
            </button>
          ))}
        </div>
        {started && (
          <div style={{ marginTop: 'var(--ra-s-5)', fontSize: 10, color: 'var(--ra-text-3)' }}>
            an outro ends this phase. skip on the bubble stops arranging and moves to polish.
          </div>
        )}
      </div>
    )
  }

  // What the template says about each cell, so a checkbox can show what
  // really plays rather than what the user happens to have overridden. One
  // shared implementation with the write path and the map (@shared/
  // coachMapTemplate), so the pre-fill cannot drift between them.
  const homeType = homeTypeFor(coach)
  const phraseBars = phraseBarsFor(coach)
  const fallback = templateFallbackFor(draft, homeType, climax)

  return (
    <div style={panelStyle}>
      <div className="ra-eyebrow">this section</div>

      <input
        value={draft.name}
        onChange={(e) => dispatch({ type: 'COACH_SET_SECTION_NAME', name: e.target.value })}
        style={{
          marginTop: 'var(--ra-s-5)',
          width: '100%',
          height: 22,
          borderRadius: 0,
          border: '1px solid var(--ra-border)',
          background: 'var(--ra-bg-row-active)',
          color: 'var(--ra-text)',
          fontSize: 11,
          padding: '0 6px'
        }}
      />

      <div style={{ ...rowStyle, alignItems: 'center', flexWrap: 'nowrap' }}>
        {COACH_SECTION_PASS_NUDGES.map((delta) => (
          <button
            key={delta}
            type="button"
            onClick={() => dispatch({ type: 'COACH_NUDGE_SECTION_PASSES', delta })}
            style={buttonStyle}
          >
            {delta > 0 ? `+${delta}` : `${delta}`}
          </button>
        ))}
        {/* Both numbers, because a count of passes alone does not tell you
            how long the section is -- that depends on the phrase length the
            user answered. */}
        <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
          {draft.passes} × {phraseBars} bars
        </span>
      </div>

      <div style={{ marginTop: 'var(--ra-s-6)' }}>
        {climax.stems.map((stem) => {
          // Pass 0's answer stands for the whole stem here, which is what a
          // single checkbox can honestly say; ticking it writes every pass.
          const on = cellIsOn(draft.cells, 0, stem.path, fallback(stem, 0))
          return (
            <label
              key={stem.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--ra-s-2)',
                marginTop: 'var(--ra-s-1)',
                fontSize: 10,
                lineHeight: 'var(--ra-lh-body)',
                color: on ? 'var(--ra-text)' : 'var(--ra-text-3)',
                cursor: 'pointer'
              }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => dispatch({ type: 'COACH_TOGGLE_SECTION_STEM', path: stem.path })}
              />
              {/* The one colour in this panel, and the legitimate one: a
                  stem's own identity, which carries real audio
                  information. */}
              <span
                style={{
                  width: 6,
                  height: 6,
                  flex: 'none',
                  background: typeColorVar(stem.type),
                  opacity: on ? 1 : 0.3
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {stem.name}
              </span>
              {/* Just the stem's kinds. The "usually out here" hint went
                  with the pre-fill: the suggestion is already APPLIED, and
                  marking a stem the template has already switched off would
                  be the app arguing with itself. */}
              <span style={{ flex: 'none', fontSize: 9, color: 'var(--ra-text-3)' }}>
                {slotKindsLabel(stem.kinds)}
              </span>
            </label>
          )
        })}
      </div>

      <div style={{ ...rowStyle, marginTop: 'var(--ra-s-6)' }}>
        <button type="button" onClick={() => runOp('preview')} style={buttonStyle}>
          {previewing ? 'stop' : 'loop just this section'}
        </button>
        <button type="button" onClick={() => runOp('place')} style={buttonStyle}>
          put it on the timeline
        </button>
      </div>
    </div>
  )
}
