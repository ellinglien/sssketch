import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode
} from 'react'
import { initialState, SNAP_DIVS, type Action, type AppState } from './store'
import { createHistoryState, historyReducer } from './history'
import { AudioEngine } from '../audio/AudioEngine'
import { loopLengthBars, resolveOffsetKey, stemStartBar } from './selectors'

const StateCtx = createContext<AppState>(initialState)
const DispatchCtx = createContext<Dispatch<Action>>(() => {})

export interface HistoryControls {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

const HistoryCtx = createContext<HistoryControls>({
  undo: () => {},
  redo: () => {},
  canUndo: false,
  canRedo: false
})

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [history, rawDispatch] = useReducer(historyReducer, initialState, createHistoryState)
  const state = history.present
  // The rest of the app only ever sees Action, never UNDO/REDO — those are only
  // reachable through useHistory()'s bound undo/redo below, keeping the two
  // concerns (making an edit vs. navigating history) separately typed.
  const dispatch = rawDispatch as Dispatch<Action>
  const undo = useCallback(() => rawDispatch({ type: 'UNDO' }), [])
  const redo = useCallback(() => rawDispatch({ type: 'REDO' }), [])
  const historyControls = useMemo<HistoryControls>(
    () => ({ undo, redo, canUndo: history.past.length > 0, canRedo: history.future.length > 0 }),
    [undo, redo, history.past.length, history.future.length]
  )

  // Mirrors the latest state for the engine's getter callbacks below. Both this and
  // the engine itself are only ever created/mutated inside effects (never directly
  // during render) — the project's react-hooks/refs lint rule disallows touching a
  // ref's `.current` (read or write) synchronously during render, even for the
  // classic "lazy singleton" pattern, since React Compiler can't prove such access
  // is render-safe. The engine's own callbacks only dereference `stateRef.current`
  // when actually invoked later (rAF ticks, dispatch-triggered effects), never
  // during render, so mirroring it a tick late (post-commit) is never observed.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  const engineRef = useRef<AudioEngine | null>(null)
  // Declared first (and with an empty dep array) so it runs — and creates the
  // engine — before any other effect in this component during the initial commit;
  // later effects below can then safely assume engineRef.current is non-null.
  useEffect(() => {
    engineRef.current = new AudioEngine({
      getRifffs: () => Object.values(stateRef.current.rifffs),
      getOffsetSteps: (groupId, slot) => {
        const key = resolveOffsetKey(stateRef.current, groupId, slot)
        return stateRef.current.off[key] ?? 0
      },
      getSnapDiv: () => SNAP_DIVS[stateRef.current.snapIdx],
      getVolume: (key) => stateRef.current.vol[key] ?? 1,
      isMuted: (key) => !!stateRef.current.mute[key],
      getProjectBpm: () => stateRef.current.bpm,
      isStretchOn: (groupId) => stateRef.current.stretch[groupId] ?? true,
      getStemStartBar: (groupId, slot) => stemStartBar(stateRef.current, groupId, slot),
      getFadeInBars: (groupId) => stateRef.current.fadeIn[groupId] ?? 0,
      getFadeOutBars: (groupId) => stateRef.current.fadeOut[groupId] ?? 0
    })
  }, [])

  useEffect(() => {
    engineRef.current!.updateLiveGains()
  }, [state.vol, state.mute])

  useEffect(() => {
    if (state.playing) {
      engineRef.current!.play(state.pos)
      let raf: number
      let lastTick = 0
      // engine.play() only schedules audio for one pass through the timeline —
      // currentPos()'s modulo makes the *displayed* position loop, but nothing
      // else re-triggers scheduling when it wraps, so audio would go silent
      // after 32 bars while the playhead kept animating. Track the position
      // locally (not via React state, which lags a render behind) and re-call
      // play() the instant it wraps, reusing the same reschedule mechanism
      // Task 16 uses for live offset/tempo changes.
      let lastPos = state.pos
      const tick = (t: number): void => {
        if (t - lastTick > 55) {
          lastTick = t
          const newPos = engineRef.current!.currentPos(loopLengthBars(stateRef.current))
          if (newPos < lastPos) {
            engineRef.current!.play(newPos)
          }
          lastPos = newPos
          dispatch({ type: 'SET_POS', pos: newPos })
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    } else {
      engineRef.current!.stop()
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-runs on play/pause transitions; state.pos is read once at play-start via stateRef/closure, not tracked as a dependency
  }, [state.playing])

  // Re-schedules playback in place when offset/tempo/snap/unlink/placement change
  // while already playing, so the change takes effect immediately instead of only on
  // the next play(). state.rifffs is included so dragging a clip to a new position,
  // dropping a new one in, removing one, or baking a new path all reschedule too —
  // without it, a mid-playback change to *where* something plays only took effect on
  // the next full loop wrap, leaving audio and the visible arrangement out of sync
  // until then.
  useEffect(() => {
    if (state.playing) {
      engineRef.current!.play(engineRef.current!.currentPos(loopLengthBars(state)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes state.playing; the play/pause effect above already handles play/pause transitions, this effect should only re-run when scheduling-affecting values actually change
  }, [
    state.off,
    state.bpm,
    state.snapIdx,
    state.unlinked,
    state.stretch,
    state.rifffs,
    state.stemStart,
    state.fadeIn,
    state.fadeOut
  ])

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>
        <HistoryCtx.Provider value={historyControls}>{children}</HistoryCtx.Provider>
      </DispatchCtx.Provider>
    </StateCtx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useAppState(): AppState {
  return useContext(StateCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useDispatch(): Dispatch<Action> {
  return useContext(DispatchCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useHistory(): HistoryControls {
  return useContext(HistoryCtx)
}
