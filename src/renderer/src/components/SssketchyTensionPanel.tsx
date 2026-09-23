import { useCallback, useEffect, useMemo } from 'react'
import { markManualSeek } from '../state/manualSeek'
import { registerCoachTensionOp } from '../state/coachTensionBridge'
import {
  buildCoachTensionActions,
  buildCoachTensionRemovalActions
} from '../state/coachTensionApply'
import { useAppState, useDispatch, usePlaying } from '../state/StoreContext'
import { coachBoundaries } from '@shared/coachPhase3'
import {
  appliedTensionRiserId,
  coachTensionDef,
  tensionIsApplied,
  type CoachSectionBoundary,
  type CoachTensionKind,
  type CoachTensionOp
} from '@shared/coachTension'
import type { Action } from '../state/store'

/**
 * Phase three's own panel: one row per section JOIN the names ask something
 * of, and one toggle per offer.
 *
 * Two rules this component exists to enforce:
 *
 * **Everything is off until a click.** Nothing here writes on mount, on a
 * step change, or on a render. This is the mirror image of phase two's
 * everything-on default and it points the other way for a reason: phase two
 * subtracts from a loop the user already built, phase three ADDS material
 * to the arrangement, and adding it uninvited is an edit they then have to
 * notice and undo.
 *
 * **Every toggle is one undo step.** The real edits (SET_GROUP_AUTOMATION,
 * ADD_RISER, REMOVE_RISER) go out in the SAME BATCH as the COACH_APPLY_
 * TENSION / COACH_CLEAR_TENSION that records them, and history.ts
 * checkpoints a BATCH exactly once.
 *
 * The listen button sits on the boundary's own header rather than on each
 * toggle: every offer at one boundary covers the same span and is heard in
 * the same pass over the REAL project (nothing throwaway is sent to the
 * engine here, unlike phase two's preview), so four identical buttons would
 * be four ways to do one thing.
 *
 * Rendered INSIDE the bubble, below its one line and above its button rows,
 * and mounted only while p3-tension is the current step -- which is also
 * what makes the bridge below safe to leave unqueued (coachTensionBridge.ts
 * drops a request that finds no panel).
 */
export function SssketchyTensionPanel(): React.JSX.Element | null {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const coach = state.coach

  /** Seeks to the start of the section leading into this join and plays the
   * project as it actually is. Same shape Ruler.tsx's seekTo uses: while
   * playing the engine is told directly (and the tick guard armed) so the
   * playhead does not flicker back; while stopped, updating pos is enough,
   * because enginePlay reads it fresh at play-start. */
  const listenAt = useCallback(
    (boundary: CoachSectionBoundary): void => {
      const section = coach?.sections[boundary.index]
      if (section === undefined) return
      const pos = section.startBar
      dispatch({ type: 'SET_POS', pos })
      if (playing) {
        markManualSeek()
        void window.rifffApi.engineSetPosition(pos)
      } else {
        dispatch({ type: 'PLAY' })
      }
    },
    [coach, dispatch, playing]
  )

  const toggle = useCallback(
    (boundary: CoachSectionBoundary, kind: CoachTensionKind): void => {
      if (coach === null) return
      const section = coach.sections[boundary.index]
      if (section === undefined) return

      if (tensionIsApplied(coach.tension, boundary.index, kind)) {
        const riserId = appliedTensionRiserId(coach.tension, boundary.index)
        const actions: Action[] = [
          ...buildCoachTensionRemovalActions(state, section, kind, riserId),
          { type: 'COACH_CLEAR_TENSION', sectionIndex: boundary.index, kind }
        ]
        dispatch({ type: 'BATCH', actions })
        return
      }

      const built = buildCoachTensionActions(state, section, kind, {
        riserId: crypto.randomUUID(),
        channelId: crypto.randomUUID()
      })
      if (built.actions.length === 0) return
      dispatch({
        type: 'BATCH',
        actions: [
          ...built.actions,
          {
            type: 'COACH_APPLY_TENSION',
            sectionIndex: boundary.index,
            kind,
            riserId: built.riserId
          }
        ]
      })
    },
    [coach, dispatch, state]
  )

  /** "add all of these" -- the step's primary move, and the one bulk
   * application in this phase. Built as ONE batch so the whole pass is a
   * single undo step. Every riser in it gets a row of its own, exactly like
   * one added by hand from the arranger's right-click menu. */
  const addAll = useCallback((): void => {
    if (coach === null) return
    const actions: Action[] = []
    for (const boundary of coachBoundaries(coach)) {
      const section = coach.sections[boundary.index]
      if (section === undefined) continue
      for (const kind of boundary.offers) {
        if (tensionIsApplied(coach.tension, boundary.index, kind)) continue
        const built = buildCoachTensionActions(state, section, kind, {
          riserId: crypto.randomUUID(),
          channelId: crypto.randomUUID()
        })
        if (built.actions.length === 0) continue
        actions.push(...built.actions, {
          type: 'COACH_APPLY_TENSION',
          sectionIndex: boundary.index,
          kind,
          riserId: built.riserId
        })
      }
    }
    if (actions.length === 0) return
    dispatch({ type: 'BATCH', actions })
  }, [coach, dispatch, state])

  // Memoised, not recomputed inline: this list is in the effect's dependency
  // array below, and a fresh array every render would tear the bridge
  // registration down and put it back on every single render.
  const boundaries = useMemo<CoachSectionBoundary[]>(
    () => (coach === null ? [] : coachBoundaries(coach)),
    [coach]
  )

  // The walk and the tension pass are the same journey seen twice, so the
  // join the user is standing next to leads. Sorted, never filtered: the
  // others are still there, because a pass that hid the joins you were not
  // on would be a flow you cannot skim.
  const ordered = useMemo<CoachSectionBoundary[]>(() => {
    const walkIndex = coach?.walkIndex ?? null
    if (walkIndex === null) return boundaries
    return [...boundaries].sort(
      (a, b) => Math.abs(a.index - walkIndex) - Math.abs(b.index - walkIndex)
    )
  }, [boundaries, coach])

  // Registered in an effect with its own teardown -- no setState here, so
  // react-hooks/set-state-in-effect is satisfied by construction.
  //
  // Reads `boundaries`, not `ordered`: "play the first join" means the first
  // in TIMELINE order, which is what a person asking for it means, not
  // whichever one the walk happens to be nearest.
  useEffect(() => {
    return registerCoachTensionOp((op: CoachTensionOp): void => {
      if (op === 'add-all') {
        addAll()
        return
      }
      const [first] = boundaries
      if (first !== undefined) listenAt(first)
    })
  }, [addAll, boundaries, listenAt])

  if (coach === null) return null

  const panelStyle: React.CSSProperties = {
    marginTop: 'var(--ra-s-5)',
    borderTop: '1px solid var(--ra-border)',
    paddingTop: 'var(--ra-s-5)',
    // The bubble grows upward off a fixed bottom edge, and a track with
    // several drops can carry more rows than a short window has room for.
    // Same treatment the section panel already gives its own stem list.
    maxHeight: '40vh',
    overflowY: 'auto'
  }

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

  if (boundaries.length === 0) {
    return (
      <div style={panelStyle}>
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
          no joins here ask for anything. next when you are ready.
        </div>
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      {ordered.map((boundary) => (
        <div key={boundary.index} style={{ marginBottom: 'var(--ra-s-5)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--ra-s-2)',
              fontSize: 10,
              color: 'var(--ra-text-2)'
            }}
          >
            <span style={{ flex: 1 }}>
              {boundary.fromName} into {boundary.intoName}, bar {boundary.bar}
            </span>
            <button type="button" style={buttonStyle} onClick={() => listenAt(boundary)}>
              listen
            </button>
          </div>
          {boundary.offers.map((kind) => {
            const def = coachTensionDef(kind)
            const on = tensionIsApplied(coach.tension, boundary.index, kind)
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggle(boundary, kind)}
                title={
                  on
                    ? 'take it back off -- anything drawn on that lane since goes with it'
                    : def.note
                }
                style={{
                  ...buttonStyle,
                  display: 'block',
                  width: '100%',
                  height: 'auto',
                  textAlign: 'left',
                  padding: '4px 8px',
                  marginTop: 'var(--ra-s-1)',
                  border: `1px solid ${on ? 'var(--ra-text-2)' : 'var(--ra-border)'}`,
                  color: on ? 'var(--ra-text)' : 'var(--ra-text-3)'
                }}
              >
                {on ? `on · ${def.label}` : def.label}
                <span
                  style={{
                    display: 'block',
                    marginTop: 2,
                    fontSize: 9,
                    lineHeight: 1.4,
                    color: 'var(--ra-text-3)'
                  }}
                >
                  {def.note}
                </span>
              </button>
            )
          })}
        </div>
      ))}
      <div style={{ fontSize: 9, color: 'var(--ra-text-3)', lineHeight: 1.4 }}>
        everything here is an ordinary curve or an ordinary riser afterwards. move it, resize it,
        redraw it. one undo takes any of it back off.
      </div>
    </div>
  )
}
