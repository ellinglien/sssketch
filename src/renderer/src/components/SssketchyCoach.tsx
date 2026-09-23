import { useEffect, useState } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { SssketchySprite } from './SssketchySprite'
import { SssketchyChecklist } from './SssketchyChecklist'
import { coachAnimation, isCoachStuck, type CoachState } from '@shared/coach'
import { coachLineFor, coachSeededLine } from '@shared/coachPhase1'
import {
  coachStepById,
  coachStepPrimaryMove,
  resolveCoachStep,
  type CoachMoveAction,
  type CoachOfferAction
} from '@shared/coachSteps'
import type { CoachSlotSnapshot } from '@shared/coachClimax'
import { COACH_NO_MOVES_LINES, COACH_STUCK_LINES, pickLineVariant } from '@shared/coachLines'

const BUBBLE_WIDTH = 300
const SPRITE_SIZE = 64
/** Where he stands when the current step has no anchor of its own, or when
 * the step's anchor is not on screen (every phase-one step points at
 * Discover's add row, which only exists while the riff library is open on
 * the discover tab). */
const DEFAULT_LEFT = 16
/**
 * How often he looks for his step's anchor element again.
 *
 * A poll rather than the resize/scroll listeners alone, because every
 * phase-one step names the SAME anchor (Discover's add row) and that
 * element appears and disappears with the riff library modal -- neither the
 * selector changing nor a resize nor a scroll fires when the modal opens,
 * so a listeners-only version measures once, finds nothing, and parks him
 * in the corner for the whole of phase one. One querySelector plus one
 * getBoundingClientRect at this rate is cheap, it only runs while a flow is
 * actually on screen with an anchored step, and the state it writes is
 * identity-stable when nothing moved, so a still screen re-renders nothing.
 */
const ANCHOR_POLL_MS = 500
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
 * through. A step whose anchor is not currently mounted (every phase-one
 * step names Discover's add row, which exists only while the riff library
 * is open on the discover tab) parks him in the corner instead.
 *
 * `anchored` is the second half of the answer, and it is half of which
 * layer he sits on: standing on something inside a full-screen view means
 * he has to float above that view's own content, which is exactly what
 * --ra-z-fullscreen-popover is for. The other half is whether the riff
 * library is open at all -- he can be parked in its corner with no anchor
 * in sight, on its browse tab -- see the panel's own `zIndex`.
 */
function useAnchorLeft(
  selector: string | undefined,
  width: number
): { left: number; anchored: boolean } {
  const [anchor, setAnchor] = useState<{ left: number; anchored: boolean }>({
    left: DEFAULT_LEFT,
    anchored: false
  })

  useEffect(() => {
    if (selector === undefined) return undefined
    const update = (): void => {
      const element = document.querySelector(selector)
      const next =
        element === null
          ? { left: DEFAULT_LEFT, anchored: false }
          : {
              left: Math.min(
                Math.max(element.getBoundingClientRect().left, 12),
                window.innerWidth - width - 12
              ),
              anchored: true
            }
      // Identity-stable when nothing moved, so the poll below costs a
      // measurement rather than a render.
      setAnchor((prev) =>
        prev.left === next.left && prev.anchored === next.anchored ? prev : next
      )
    }
    update()
    const pollId = window.setInterval(update, ANCHOR_POLL_MS)
    window.addEventListener('resize', update)
    // Deliberately NO capture-phase scroll listener. One was here, and it
    // ran update() synchronously for every scroll event from every scroller
    // in the app -- timeline, library lists, inspector -- each forcing a
    // layout flush through getBoundingClientRect. That is the exact thrash
    // pattern that cost this renderer a beachball once already, and the poll
    // above covers every case it did, twice a second, off the event path.
    return () => {
      window.clearInterval(pollId)
      window.removeEventListener('resize', update)
    }
  }, [selector, width])

  if (selector === undefined) return { left: DEFAULT_LEFT, anchored: false }
  return anchor
}

/**
 * sssketchy on screen: the sprite on the bottom edge, and one speech bubble
 * carrying exactly one thought.
 *
 * The rule this component exists to enforce (spec, "What he is allowed to
 * say"): **one thought at a time**. There is exactly one `line` here, read
 * straight off the current step. There is no list, no queue, no pending
 * suggestions, and nowhere for an unacted suggestion to accumulate. Exactly
 * one second string can ever appear beneath it, and the two take turns in
 * the same slot: the ten-minute nudge, which the spec itself carves out as
 * "the one exception... triggered by elapsed clock time -- a fact, not a
 * guess about the music", and the seeded-start note, which names the roles
 * an existing riff already covered. Both only ever point back at the same
 * buttons already on the bubble.
 */
function SssketchyCoachPanel({
  coach,
  discoverSlots,
  riffLibraryOpen,
  onOffer,
  onMove,
  onNext,
  onSkip,
  onMinimise,
  onRestore,
  onDismiss
}: {
  coach: CoachState
  /** What Discover currently holds, as the guided flow is allowed to see it
   * (DiscoverPanel publishes it up through App.tsx). Drives step
   * completion, the seeded note and the climb animation. */
  discoverSlots: readonly CoachSlotSnapshot[]
  /** Whether the riff library -- the full-screen view the whole of phase
   * one happens inside -- is open. See `zIndex` below. */
  riffLibraryOpen: boolean
  onOffer: (action: CoachOfferAction) => void
  onMove: (action: CoachMoveAction) => void
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

  const rawStep = coachStepById(coach.stepId)
  // Per-flavour copy, moves and label, flattened once here so nothing below
  // has to remember that overrides exist.
  const step = rawStep === undefined ? undefined : resolveCoachStep(rawStep, coach.flavour)
  const { left, anchored } = useAnchorLeft(step?.anchorSelector, BUBBLE_WIDTH)
  // Above the riff library's own full-screen view whenever he is INSIDE it
  // -- either standing on something in it (every phase-one step anchors to
  // Discover's add row) or parked in its corner. Without this he is painted
  // UNDER the library for the whole of phase one: the library is
  // --ra-z-fullscreen (1000), this used to be --ra-z-anchored (100).
  //
  // `anchored` alone was not enough, and the opening step is exactly where
  // it showed: "start from a riff you love" opens the library on the BROWSE
  // tab, where DiscoverPanel is not mounted at all, so the anchor does not
  // exist, he drops to the anchored layer, and the one offer the spec names
  // by hand leads to a screen where he cannot be seen and the
  // melodic-or-groove question cannot be answered. Asking whether the
  // library is open answers it for every tab.
  //
  // Deliberately NOT "is any overlay open": parked in the corner with no
  // full-screen view around him he stays an ordinary anchored popover, so
  // he never floats over an unrelated modal (--ra-z-modal, 110). That
  // distinction is the point of d67efaa.
  const zIndex =
    anchored || riffLibraryOpen ? 'var(--ra-z-fullscreen-popover)' : 'var(--ra-z-anchored)'

  // "walk = moving to another area (Discover -> timeline)" (spec), and
  // "jump = step finished" -- which also fires when he first appears, and
  // reads as a greeting rather than as a mistake.
  const walking = usePulse(left, WALK_MS, false)
  const celebrating = usePulse(coach.stepId, JUMP_MS, true)

  const stuck = isCoachStuck(coach, now)
  const animation = coachAnimation({
    status: coach.status,
    // "climb = while the app works" -- a real fact off the slots, not a
    // guess: a slot is mid-roll or it is not.
    working: discoverSlots.some((slot) => slot.rolling),
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
      zIndex={zIndex}
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
            zIndex
          }}
        >
          {sprite}
        </div>
      </>
    )
  }

  const finished = coach.status === 'finished'
  const moves = step?.moves ?? []
  // "do it for me" runs exactly one move -- the step's primary. A step with
  // none (the melodic-or-groove question, the balance pass) leaves the
  // button disabled, which is the honest answer: one of those is a decision
  // only the user can make, the other is a person listening.
  const primaryMove = rawStep === undefined ? null : coachStepPrimaryMove(rawStep, coach.flavour)
  const offers = step?.offers ?? []
  const seededLine = coachSeededLine(coach.seededKinds, step?.label ?? '', coach.lineSeed)

  return (
    <>
      {checklist}
      <div
        style={{
          position: 'fixed',
          left,
          bottom: 12,
          width: BUBBLE_WIDTH,
          zIndex
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
            {coachLineFor(coach, discoverSlots)}
          </div>

          {/* The seeded-start note: "you already have drummy and bassish.
              next: harmony." Sits in the same slot the ten-minute nudge
              uses, and is cleared by the next transition (advanceCoach), so
              there is still only ever one thought plus at most one aside. */}
          {seededLine !== null && !finished && (
            <div
              style={{
                marginTop: 'var(--ra-s-2)',
                fontSize: 10,
                lineHeight: 'var(--ra-lh-body)',
                color: 'var(--ra-text-3)'
              }}
            >
              {seededLine}
            </div>
          )}

          {stuck && !finished && seededLine === null && (
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
                  <button
                    key={move.id}
                    type="button"
                    onClick={() => onMove(move.action)}
                    style={{ ...bubbleButtonStyle, display: 'block', marginTop: 'var(--ra-s-1)' }}
                  >
                    {move.label}
                  </button>
                ))
              )}
            </div>
          )}

          {/* Answers only the user can give -- their own row, above the
              fixed one, so "do it for me" is never how a decision about the
              track gets made. Only the melodic-or-groove question has
              these. */}
          {!finished && offers.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--ra-s-1)',
                marginTop: 'var(--ra-s-5)'
              }}
            >
              {offers.map((offer) => (
                <button
                  key={offer.id}
                  type="button"
                  onClick={() => onOffer(offer.action)}
                  style={bubbleButtonStyle}
                >
                  {offer.label}
                </button>
              ))}
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
                {/* Disabled on a step whose work is not the app's to do:
                    the melodic-or-groove question (a decision only the user
                    can make) and the balance pass (a person listening).
                    Dimmed to the app's own disabled treatment (30% opacity,
                    not-allowed) rather than a custom one. */}
                <button
                  type="button"
                  disabled={primaryMove === null}
                  onClick={() => {
                    if (primaryMove !== null) onMove(primaryMove.action)
                  }}
                  title={primaryMove === null ? 'this one is yours' : primaryMove.label}
                  style={{
                    ...bubbleButtonStyle,
                    opacity: primaryMove === null ? 0.3 : 1,
                    cursor: primaryMove === null ? 'not-allowed' : 'pointer'
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
export function SssketchyCoach({
  discoverSlots,
  riffLibraryOpen,
  onOffer,
  onMove
}: {
  /** What Discover currently holds, as the guided flow is allowed to see it
   * (DiscoverPanel publishes it up through App.tsx). */
  discoverSlots: readonly CoachSlotSnapshot[]
  /** Whether the riff library is open, on any tab -- it is the full-screen
   * view phase one happens inside, and he has to paint above it. */
  riffLibraryOpen: boolean
  onOffer: (action: CoachOfferAction) => void
  onMove: (action: CoachMoveAction) => void
}): React.JSX.Element | null {
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  if (coach === null || coach.status === 'dismissed') return null
  return (
    <SssketchyCoachPanel
      coach={coach}
      discoverSlots={discoverSlots}
      riffLibraryOpen={riffLibraryOpen}
      onOffer={onOffer}
      onMove={onMove}
      onNext={() => dispatch({ type: 'COACH_ADVANCE', now: Date.now(), outcome: 'done' })}
      onSkip={() => dispatch({ type: 'COACH_ADVANCE', now: Date.now(), outcome: 'skipped' })}
      onMinimise={() => dispatch({ type: 'COACH_MINIMISE' })}
      onRestore={() => dispatch({ type: 'COACH_RESTORE', now: Date.now() })}
      onDismiss={() => dispatch({ type: 'COACH_DISMISS', now: Date.now() })}
    />
  )
}
