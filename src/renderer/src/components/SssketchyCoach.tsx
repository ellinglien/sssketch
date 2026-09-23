import { useEffect, useState } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { SssketchySprite } from './SssketchySprite'
import { SssketchyChecklist } from './SssketchyChecklist'
import { coachAnimation, coachLine, isCoachStuck, type CoachState } from '@shared/coach'
import { coachStepById } from '@shared/coachSteps'
import { COACH_NO_MOVES_LINES, COACH_STUCK_LINES, pickLineVariant } from '@shared/coachLines'

const BUBBLE_WIDTH = 300
const SPRITE_SIZE = 64
/** Where he stands when the current step has no anchor of its own -- which
 * is every step in this build. */
const DEFAULT_LEFT = 16
/** How often the panel re-reads the clock, purely so the ten-minute nudge
 * and the checklist's phase timers appear without a user gesture. Coarse on
 * purpose: nothing here needs second accuracy, and the store is never
 * touched by this -- it is local state, so nothing else in the app
 * re-renders. */
const CLOCK_TICK_MS = 15_000
/** How long the walk plays after he moves to a new anchor. */
const WALK_MS = 700
/** How long the jump plays after a step is completed. */
const JUMP_MS = 900

const bubbleButtonStyle: React.CSSProperties = {
  height: 20,
  borderRadius: 0,
  padding: '0 8px',
  fontSize: 10,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text-2)',
  cursor: 'pointer'
}

/** A local clock, ticking coarsely, owned by the panel so the whole thing
 * re-renders off ONE clock rather than each row running its own -- and so
 * that "ten minutes have passed" never has to go through the store. */
function useCoarseClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/**
 * True for `ms` after `key` changes, then false until it changes again.
 *
 * Written as "which key has already settled" rather than the obvious
 * boolean-plus-reset, because the obvious version needs a setState in an
 * effect body to clear the flag when the key changes -- a cascading render,
 * and a lint error in this repo (react-hooks/set-state-in-effect). Here the
 * only setState is inside the timeout callback, and a key change makes the
 * pulse true again by derivation, during render, with no effect at all.
 *
 * `onFirstRender` is the difference between the jump (he greets you when he
 * appears) and the walk (appearing somewhere is not travelling there).
 */
function usePulse(key: string | number, ms: number, onFirstRender: boolean): boolean {
  const [settledKey, setSettledKey] = useState<string | number | null>(() =>
    onFirstRender ? null : key
  )
  useEffect(() => {
    if (settledKey === key) return undefined
    const id = window.setTimeout(() => setSettledKey(key), ms)
    return () => window.clearTimeout(id)
  }, [key, ms, settledKey])
  return settledKey !== key
}

/**
 * Where the bubble sits: pinned to the current step's anchor element if it
 * has one, otherwise parked in the bottom-left corner.
 *
 * Same look-the-target-up-fresh approach TourOverlay.tsx uses, for the same
 * reason: a step's anchor lives in an unrelated component (Discover, the
 * timeline, the project menu) with no shared parent worth threading a ref
 * through. Every placeholder step in this build leaves anchorSelector unset,
 * so he parks in the corner until the phase plans set them.
 */
function useAnchorLeft(selector: string | undefined, width: number): number {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (selector === undefined) return undefined
    const update = (): void => {
      const element = document.querySelector(selector)
      setRect(element === null ? null : element.getBoundingClientRect())
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [selector])

  if (selector === undefined || rect === null) return DEFAULT_LEFT
  return Math.min(Math.max(rect.left, 12), window.innerWidth - width - 12)
}

/**
 * sssketchy on screen: the sprite on the bottom edge, and one speech bubble
 * carrying exactly one thought.
 *
 * The rule this component exists to enforce (spec, "What he is allowed to
 * say"): **one thought at a time**. There is exactly one `line` here, read
 * straight off the current step. There is no list, no queue, no pending
 * suggestions, and nowhere for an unacted suggestion to accumulate. The only
 * second string that can ever appear is the ten-minute nudge, which the spec
 * itself carves out as "the one exception... triggered by elapsed clock time
 * -- a fact, not a guess about the music" -- and which only ever points back
 * at the same buttons already on the bubble.
 */
function SssketchyCoachPanel({
  coach,
  onNext,
  onSkip,
  onMinimise,
  onRestore,
  onDismiss
}: {
  coach: CoachState
  onNext: () => void
  onSkip: () => void
  onMinimise: () => void
  onRestore: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const now = useCoarseClock()
  const [checklistOpen, setChecklistOpen] = useState(false)
  // Which step's "stuck?" panel is open, rather than a bare boolean: a
  // panel left open from the previous step would be a second thing on
  // screen competing with the new step's line, and storing the step id
  // closes it on a step change by derivation rather than by an effect.
  const [stuckOpenFor, setStuckOpenFor] = useState<string | null>(null)
  const stuckOpen = stuckOpenFor === coach.stepId

  const step = coachStepById(coach.stepId)
  const left = useAnchorLeft(step?.anchorSelector, BUBBLE_WIDTH)

  // "walk = moving to another area (Discover -> timeline)" (spec), and
  // "jump = step finished" -- which also fires when he first appears, and
  // reads as a greeting rather than as a mistake.
  const walking = usePulse(left, WALK_MS, false)
  const celebrating = usePulse(coach.stepId, JUMP_MS, true)

  const stuck = isCoachStuck(coach, now)
  const animation = coachAnimation({
    status: coach.status,
    // Nothing in the framework build starts work on the user's behalf --
    // the phase plans are what make him climb.
    working: false,
    moving: walking,
    justAdvanced: celebrating,
    stuck
  })

  const sprite = (
    <SssketchySprite
      animation={animation}
      size={SPRITE_SIZE}
      onClick={() => setChecklistOpen((open) => !open)}
      title="the method"
    />
  )

  const checklist = checklistOpen && (
    <SssketchyChecklist
      coach={coach}
      now={now}
      onClose={() => setChecklistOpen(false)}
      onRestore={
        coach.status === 'minimised'
          ? () => {
              setChecklistOpen(false)
              onRestore()
            }
          : undefined
      }
    />
  )

  if (coach.status === 'minimised') {
    return (
      <>
        {checklist}
        <div
          style={{
            position: 'fixed',
            left: DEFAULT_LEFT,
            bottom: 12,
            zIndex: 'var(--ra-z-anchored)'
          }}
        >
          {sprite}
        </div>
      </>
    )
  }

  const finished = coach.status === 'finished'
  const moves = step?.moves ?? []

  return (
    <>
      {checklist}
      <div
        style={{
          position: 'fixed',
          left,
          bottom: 12,
          width: BUBBLE_WIDTH,
          zIndex: 'var(--ra-z-anchored)'
        }}
      >
        <div
          style={{
            background: 'var(--ra-bg-bar)',
            border: '1px solid var(--ra-border-strong)',
            borderRadius: 0,
            padding: 'var(--ra-s-5)',
            boxShadow: 'var(--ra-shadow-popover)'
          }}
        >
          <div
            style={{
              fontSize: 11,
              lineHeight: 'var(--ra-lh-body)',
              color: 'var(--ra-text)'
            }}
          >
            {coachLine(coach)}
          </div>

          {stuck && !finished && (
            <div
              style={{
                marginTop: 'var(--ra-s-2)',
                fontSize: 10,
                lineHeight: 'var(--ra-lh-body)',
                color: 'var(--ra-text-3)'
              }}
            >
              {pickLineVariant(COACH_STUCK_LINES, coach.lineSeed)}
            </div>
          )}

          {stuckOpen && !finished && (
            <div style={{ marginTop: 'var(--ra-s-2)' }}>
              {moves.length === 0 ? (
                <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
                  {pickLineVariant(COACH_NO_MOVES_LINES, coach.lineSeed)}
                </div>
              ) : (
                moves.map((move) => (
                  <div
                    key={move.id}
                    style={{
                      fontSize: 10,
                      color: 'var(--ra-text-2)',
                      marginTop: 'var(--ra-s-1)'
                    }}
                  >
                    {move.label}
                  </div>
                ))
              )}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--ra-s-1)',
              marginTop: 'var(--ra-s-5)'
            }}
          >
            {finished ? (
              <button type="button" onClick={onDismiss} style={bubbleButtonStyle}>
                done
              </button>
            ) : (
              <>
                <button type="button" onClick={onNext} style={bubbleButtonStyle}>
                  next
                </button>
                <button type="button" onClick={onSkip} style={bubbleButtonStyle}>
                  skip
                </button>
                {/* Disabled until a step actually has a move to make. The
                    phase plans give steps their moves; inventing one here
                    would be a lie in the one part of this feature that must
                    never guess. Dimmed to the app's own disabled treatment
                    (30% opacity, not-allowed) rather than a custom one. */}
                <button
                  type="button"
                  disabled={moves.length === 0}
                  onClick={() => setStuckOpenFor(coach.stepId)}
                  title={
                    moves.length === 0
                      ? 'nothing to do for you on this step yet'
                      : 'do this step for me'
                  }
                  style={{
                    ...bubbleButtonStyle,
                    opacity: moves.length === 0 ? 0.3 : 1,
                    cursor: moves.length === 0 ? 'not-allowed' : 'pointer'
                  }}
                >
                  do it for me
                </button>
                <button
                  type="button"
                  onClick={() => setStuckOpenFor(stuckOpen ? null : coach.stepId)}
                  style={bubbleButtonStyle}
                >
                  stuck?
                </button>
              </>
            )}
            {/* Spelled out rather than shrunk to a glyph: this row is the
                whole interactive surface of the bubble, and "dismiss" needs
                to read as "put him away, come back later" rather than as a
                close box that throws the flow out. The row wraps at this
                width, which is fine -- four verbs on two lines. */}
            {!finished && (
              <>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={onMinimise}
                  style={bubbleButtonStyle}
                  title="shrink him to a corner sprite, keeping your place"
                >
                  minimise
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  style={bubbleButtonStyle}
                  title="put the flow away -- the sssketchy button brings it back here"
                >
                  dismiss
                </button>
              </>
            )}
          </div>
        </div>
        <div style={{ marginTop: 'var(--ra-s-1)' }}>{sprite}</div>
      </div>
    </>
  )
}

/**
 * The store gate. Reads the one nullable coach field and renders nothing at
 * all when there is no flow or the flow is dismissed -- which is every
 * moment until the project menu's own sssketchy button is pressed, including
 * the moment right after a project with a half-finished flow is opened (see
 * sanitiseLoadedCoach). He never appears on his own.
 *
 * All hooks live in SssketchyCoachPanel below the gate, so there is never a
 * conditional hook here.
 */
export function SssketchyCoach(): React.JSX.Element | null {
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  if (coach === null || coach.status === 'dismissed') return null
  return (
    <SssketchyCoachPanel
      coach={coach}
      onNext={() => dispatch({ type: 'COACH_ADVANCE', now: Date.now(), outcome: 'done' })}
      onSkip={() => dispatch({ type: 'COACH_ADVANCE', now: Date.now(), outcome: 'skipped' })}
      onMinimise={() => dispatch({ type: 'COACH_MINIMISE' })}
      onRestore={() => dispatch({ type: 'COACH_RESTORE', now: Date.now() })}
      onDismiss={() => dispatch({ type: 'COACH_DISMISS', now: Date.now() })}
    />
  )
}
