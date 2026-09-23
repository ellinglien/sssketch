import { useCallback, useEffect } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { useCoachSectionPreview } from '../state/useCoachSectionPreview'
import { registerCoachSectionOp } from '../state/coachSectionBridge'
import { buildCoachSectionActions } from '../state/coachSectionPlacement'
import { typeColorVar } from '../theme/typeColor'
import {
  COACH_DROP_SUGGESTED_LABEL,
  COACH_SECTION_BAR_NUDGES,
  COACH_SUGGESTED_DROP_HINT,
  coachSectionTypeDef,
  isSuggestedDrop,
  nextSectionTypeSuggestions,
  suggestedDropPaths,
  type CoachSectionOp,
  type CoachSectionType
} from '@shared/coachSections'
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
 * Phase two's own surface: pick a section, carve it, put it down.
 *
 * THE RULE THIS COMPONENT RENDERS (spec): **every stem is on, and the user
 * subtracts.** Each stem row is a checkbox that starts CHECKED. A stem this
 * section type usually loses gets a quiet hint next to it and nothing else
 * -- it is still checked, still playing. The one bulk action is the "drop
 * the suggested ones" button, which is a click, not a default.
 *
 * Nothing in here may pre-apply the suggestion table. The draft arrives from
 * the store with droppedPaths empty and only ever changes through the three
 * dispatches below (COACH_TOGGLE_SECTION_STEM, COACH_DROP_SUGGESTED_STEMS
 * and, for its length and name, the two others) -- there is no local state
 * here at all, and no initialiser that could seed one.
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
    const built = buildCoachSectionActions(state, climax, draft, coach.sections)
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
      if (op === 'drop-suggested') {
        dispatch({ type: 'COACH_DROP_SUGGESTED_STEMS' })
        return
      }
      if (op === 'preview') {
        if (previewing) stopPreview()
        else if (climax !== null && draft !== null) void previewSection(climax, draft)
        return
      }
      handlePlace()
    },
    [climax, dispatch, draft, handlePlace, previewSection, previewing, stopPreview]
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

  // A drop suggests nothing -- that section is the whole loop -- so its bulk
  // button goes to the app's own disabled treatment rather than being a
  // click that does nothing.
  const nothingSuggested = suggestedDropPaths(draft.type, climax).length === 0

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
        {COACH_SECTION_BAR_NUDGES.map((delta) => (
          <button
            key={delta}
            type="button"
            onClick={() => dispatch({ type: 'COACH_NUDGE_SECTION_BARS', delta })}
            style={buttonStyle}
          >
            {delta > 0 ? `+${delta}` : `${delta}`}
          </button>
        ))}
        <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>{draft.bars} bars</span>
      </div>

      <div style={{ marginTop: 'var(--ra-s-6)' }}>
        {climax.stems.map((stem) => {
          const on = !draft.droppedPaths.includes(stem.path)
          const flagged = isSuggestedDrop(draft.type, stem)
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
              <span style={{ flex: 'none', fontSize: 9, color: 'var(--ra-text-3)' }}>
                {flagged ? COACH_SUGGESTED_DROP_HINT : slotKindsLabel(stem.kinds)}
              </span>
            </label>
          )
        })}
      </div>

      <div style={{ ...rowStyle, marginTop: 'var(--ra-s-6)' }}>
        <button
          type="button"
          disabled={nothingSuggested}
          onClick={() => runOp('drop-suggested')}
          title={
            nothingSuggested
              ? 'a drop loses nothing -- that section is the whole loop'
              : COACH_DROP_SUGGESTED_LABEL
          }
          style={{
            ...buttonStyle,
            opacity: nothingSuggested ? 0.3 : 1,
            cursor: nothingSuggested ? 'not-allowed' : 'pointer'
          }}
        >
          {COACH_DROP_SUGGESTED_LABEL}
        </button>
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
