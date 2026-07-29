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
import { initialState, type Action, type AppState } from './store'
import { createHistoryState, historyReducer } from './history'
import { buildEngineProject } from '@shared/buildEngineProject'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { loopLengthBars } from './selectors'

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

  // Mirrors the latest state for the position-update subscription below, which
  // needs to read the current loop length without itself re-subscribing on every
  // state change. Only ever written inside an effect (never during render) — the
  // project's react-hooks/refs lint rule disallows touching a ref's `.current`
  // (read or write) synchronously during render, since React Compiler can't prove
  // such access is render-safe. The subscription callback only dereferences
  // `stateRef.current` when actually invoked later (an engine push arriving),
  // never during render, so mirroring it a tick late (post-commit) is never observed.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  // Keeps the native engine's picture of the project in sync with every
  // scheduling-relevant state change — playing or not. Sending load-project
  // to a paused engine is harmless and keeps it always current for whenever
  // play is next pressed; there's no separate "reschedule while playing"
  // code path the way AudioEngine.ts needed, because PlaybackEngine::renderBlock
  // recomputes scheduling fresh from whatever project is currently loaded on
  // every single audio block — see the Phase 3 design doc.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const project = await buildEngineProject(state, resolveStretchedForPlayback)
      if (!cancelled) {
        await window.rifffApi.engineLoadProject(project)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes state.playing and state.pos; those are handled by the separate play/pause effect and the position-update subscription below, not by reloading the whole project
  }, [
    state.off,
    state.bpm,
    state.snapIdx,
    state.unlinked,
    state.stretch,
    state.rifffs,
    state.stemStart,
    state.fadeIn,
    state.fadeOut,
    state.vol,
    state.mute,
    // Missing here meant a resize-handle drag (SET_PLAYED_BARS) never
    // reached the native engine during live playback -- the reducer state
    // updated fine (so the row visibly resized and export/re-open picked it
    // up), but this effect wouldn't re-run to actually re-send the project,
    // so the engine kept scheduling the stem at its old length until some
    // OTHER tracked field happened to change too. Found via Task 12 manual
    // verification: after a resize-handle drag, the captured EngineProject
    // sent over IPC still showed the pre-drag playedBars.
    state.playedBars
  ])

  useEffect(() => {
    if (state.playing) {
      void window.rifffApi.enginePlay(state.pos)
    } else {
      void window.rifffApi.engineStop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-runs on play/pause transitions, matching the old effect's behavior; state.pos is read once at play-start via closure, not tracked as a dependency
  }, [state.playing])

  useEffect(() => {
    return window.rifffApi.onEnginePositionUpdate((pos) => {
      // The native engine's 30Hz position timer only stops once it processes
      // an in-flight 'stop' message — a tick already queued before that lands
      // anyway. Without this guard, such a straggler can dispatch a stale
      // nonzero SET_POS right after STOP just reset pos to 0, and a quick
      // Stop-then-Play could then resume from that stale position instead.
      if (!stateRef.current.playing) return
      const loopBars = loopLengthBars(stateRef.current)
      if (pos >= loopBars) {
        // Loop wrap-around: the native transport counts up monotonically
        // forever with no concept of loop length (that's a renderer-only
        // concept, computed from rifffs) — mirror the old AudioEngine.ts-era
        // wrap detection, just triggered by real engine events now instead
        // of a locally-computed value.
        const wrapped = pos % loopBars
        void window.rifffApi.engineSetPosition(wrapped)
        dispatch({ type: 'SET_POS', pos: wrapped })
      } else {
        dispatch({ type: 'SET_POS', pos })
      }
    })
  }, [dispatch])

  useEffect(() => {
    return window.rifffApi.onEngineRestarted(() => {
      dispatch({ type: 'STOP' })
    })
  }, [dispatch])

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
