import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode
} from 'react'
import { initialState, type Action, type AppState } from './store'
import { createHistoryState, historyReducer } from './history'
import { buildEngineProject } from '@shared/buildEngineProject'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { loopLengthBars } from './selectors'

// Playback position/state now live entirely outside the undo-tracked main
// reducer — see StoreProvider's dispatch below. Previously they were fields
// on AppState, updated via SET_POS/PLAY/PAUSE/STOP dispatched through the
// same reducer as every other edit; since the native engine pushes a
// position update ~30 times/sec while playing, that meant every one of
// StateCtx's consumers (every stem row, shelf tile, the inspector — anywhere
// useAppState() is called, which is most of the app) re-rendered 30x/sec
// during simple playback, whether or not it read state.pos at all. Splitting
// pos and playing into their own contexts (further split from each other,
// not just from AppState — a component that only cares whether playback is
// running, like Ruler or BeatPicker, shouldn't re-render on every position
// tick either) means only components that actually call usePos()/usePlaying()
// re-render on those changes; everything else only re-renders on a real
// arrangement edit.
export type TransportAction =
  { type: 'PLAY' } | { type: 'PAUSE' } | { type: 'STOP' } | { type: 'SET_POS'; pos: number }

export type DispatchableAction = Action | TransportAction

const StateCtx = createContext<AppState>(initialState)
const DispatchCtx = createContext<Dispatch<DispatchableAction>>(() => {})
const PosCtx = createContext<number>(0)
const PlayingCtx = createContext<boolean>(false)

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
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)

  // Intercepts the four transport actions before they ever reach the
  // undo-tracked main reducer, routing them to the separate pos/playing
  // state above instead — see the module doc comment above for why. Every
  // other action (including LOAD_STATE, which also resets transport state:
  // opening a different project should never resume mid-playback at whatever
  // position the previous one left off at) still flows through rawDispatch
  // exactly as before. Stable across renders (rawDispatch from useReducer and
  // the setState setters are both React-guaranteed stable), so this never
  // forces the position-update subscription effect below to resubscribe.
  const dispatch = useCallback((action: DispatchableAction): void => {
    switch (action.type) {
      case 'PLAY':
        setPlaying(true)
        return
      case 'PAUSE':
        setPlaying(false)
        return
      case 'STOP':
        setPlaying(false)
        setPos(0)
        return
      case 'SET_POS':
        setPos(action.pos)
        return
      case 'LOAD_STATE':
        setPlaying(false)
        setPos(0)
        rawDispatch(action)
        return
      case 'SET_SEND_BUS_PLUGIN':
        rawDispatch(action)
        void window.rifffApi.loadSendPlugin(action.bus, action.pluginId)
        return
      default:
        rawDispatch(action)
    }
  }, [])

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
  // Same pattern, for the position-update subscription's own playing check —
  // separate from stateRef since playing no longer lives on state at all.
  const playingRef = useRef(playing)
  useEffect(() => {
    playingRef.current = playing
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes playing/pos (no longer part of state at all); those are handled by the separate play/pause effect and the position-update subscription below, not by reloading the whole project
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
    if (playing) {
      void window.rifffApi.enginePlay(pos)
    } else {
      void window.rifffApi.engineStop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-runs on play/pause transitions, matching the old effect's behavior; pos is read once at play-start via closure, not tracked as a dependency
  }, [playing])

  useEffect(() => {
    return window.rifffApi.onEnginePositionUpdate((pos) => {
      // The native engine's 30Hz position timer only stops once it processes
      // an in-flight 'stop' message — a tick already queued before that lands
      // anyway. Without this guard, such a straggler can dispatch a stale
      // nonzero SET_POS right after STOP just reset pos to 0, and a quick
      // Stop-then-Play could then resume from that stale position instead.
      if (!playingRef.current) return
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
      // The respawned engine process starts with every send bus empty — the
      // main process only resends the last-known *project* on crash-recovery
      // (playbackEngineLifecycle.ts's own lastProject cache), not send-bus
      // plugin assignments. Re-issue load-send-plugin for whichever buses
      // currently have a plugin assigned, from this renderer's own live
      // state, mirroring how the project itself gets kept in sync.
      for (const [bus, pluginId] of stateRef.current.sendBusPlugins.entries()) {
        if (pluginId !== null) {
          void window.rifffApi.loadSendPlugin(bus, pluginId)
        }
      }
    })
  }, [dispatch])

  useEffect(() => {
    return window.rifffApi.onSendPluginLoaded(({ bus, success, error }) => {
      if (!success) {
        console.error(`StoreContext: send bus ${bus} failed to load plugin: ${error}`)
      }
    })
  }, [])

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>
        <PosCtx.Provider value={pos}>
          <PlayingCtx.Provider value={playing}>
            <HistoryCtx.Provider value={historyControls}>{children}</HistoryCtx.Provider>
          </PlayingCtx.Provider>
        </PosCtx.Provider>
      </DispatchCtx.Provider>
    </StateCtx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useAppState(): AppState {
  return useContext(StateCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useDispatch(): Dispatch<DispatchableAction> {
  return useContext(DispatchCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function usePos(): number {
  return useContext(PosCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function usePlaying(): boolean {
  return useContext(PlayingCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useHistory(): HistoryControls {
  return useContext(HistoryCtx)
}
