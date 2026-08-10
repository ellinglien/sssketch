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
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'
import { createHistoryState, historyReducer } from './history'
import { buildEngineProject } from '@shared/buildEngineProject'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'
import { loopLengthBars } from './selectors'
import { isWithinManualSeekGrace } from './manualSeek'
import type { PluginCatalog } from '../../../main/pluginCatalog'

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
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'STOP' }
  | { type: 'SET_POS'; pos: number }
  | { type: 'SET_ZOOM'; multiplier: number }
  | { type: 'RESET_ZOOM' }

export type DispatchableAction = Action | TransportAction

// A passive mirror of the reducer's own state (history.present, below),
// letting components subscribe to specific fields via useAppSelector
// instead of the whole AppState via useAppState()/StateCtx -- see
// docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
// This does NOT change the reducer/dispatch/undo pipeline in any way; it
// only observes its output. StoreProvider keeps this in sync (see its own
// render body below) -- nothing else should ever call __setStateForTest,
// which exists purely so this bridge's own tests don't need a real React
// render to exercise it.
let currentState: AppState = initialState
const stateListeners = new Set<() => void>()

// eslint-disable-next-line react-refresh/only-export-components -- store bridge function, not a component
export function subscribeToState(listener: () => void): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

// eslint-disable-next-line react-refresh/only-export-components -- store bridge function, not a component
export function getStateSnapshot(): AppState {
  return currentState
}

// eslint-disable-next-line react-refresh/only-export-components -- test-only helper, not a component
export function __setStateForTest(state: AppState): void {
  currentState = state
  for (const listener of stateListeners) listener()
}

const StateCtx = createContext<AppState>(initialState)
const DispatchCtx = createContext<Dispatch<DispatchableAction>>(() => {})
const PosCtx = createContext<number>(0)
const PlayingCtx = createContext<boolean>(false)
// Effective pixels-per-bar (base PPB * the current zoom multiplier) --
// consumers read this instead of importing the old hardcoded PPB constant
// directly, so the whole timeline zooms together. Separate context (not
// folded into AppState) for the same reason PosCtx/PlayingCtx are separate:
// zoom changes on every scroll tick, and only the handful of components
// that actually render at a bar<->pixel scale need to re-render when it
// changes.
const ZoomCtx = createContext<number>(24)

export type MasterChainSlotStatus = 'idle' | 'loading' | 'loaded' | 'error'

const MasterChainStatusCtx = createContext<
  [MasterChainSlotStatus, MasterChainSlotStatus, MasterChainSlotStatus, MasterChainSlotStatus]
>(['idle', 'idle', 'idle', 'idle'])
// Separate from MasterChainStatusCtx (rather than folded into it) so a
// slot's status enum stays a plain, cheap-to-compare 4-tuple -- only the
// panel's own hover tooltip needs the message text.
const MasterChainErrorCtx = createContext<
  [string | null, string | null, string | null, string | null]
>([null, null, null, null])

const ChannelChainStatusCtx = createContext<
  Record<string, [MasterChainSlotStatus, MasterChainSlotStatus]>
>({})
const ChannelChainErrorCtx = createContext<Record<string, [string | null, string | null]>>({})

const PluginCatalogCtx = createContext<PluginCatalog>({ plugins: [], favouriteIds: [] })
const PluginScanStateCtx = createContext<{
  scanning: boolean
  progress: { done: number; total: number } | null
}>({
  scanning: false,
  progress: null
})
const PluginCatalogActionsCtx = createContext<{
  triggerScan: () => void
  toggleFavourite: (id: string) => void
}>({ triggerScan: () => {}, toggleFavourite: () => {} })

const RiffFavouritesCtx = createContext<Set<string>>(new Set())
const RiffFavouritesActionsCtx = createContext<{
  toggleRiffFavourite: (riffCID: string) => void
}>({ toggleRiffFavourite: () => {} })

// The 5 plugins the old hardcoded allowlist (src/shared/masterChainAllowlist.ts,
// deleted once the scan-based catalog replaced it) used to reference by these
// exact slugs. A pre-existing project save's masterChain array may still
// contain one of these slugs -- this table resolves it to the real file path
// so it can be matched against a freshly-scanned catalog entry and swapped
// for that entry's real id (JUCE's PluginDescription::createIdentifierString(),
// not a slug). See docs/superpowers/specs/2026-07-31-plugin-scan-favourites-design.md's
// "Migration for existing saves" section.
const OLD_ALLOWLIST_SLUG_TO_PATH: Record<string, string> = {
  'solid-bus-comp': '/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3',
  'pro-q-3': '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3',
  soothe2: '/Library/Audio/Plug-Ins/VST3/soothe2.vst3',
  'sausage-fattener': '/Library/Audio/Plug-Ins/VST3/SausageFattener.vst3',
  'sunset-sound-reverb': '/Library/Audio/Plug-Ins/VST3/TR5 Sunset Sound Studio Reverb.vst3'
}

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
  // Keeps the store bridge (subscribeToState/getStateSnapshot, above) in
  // sync with this render's state, synchronously -- safe because React
  // always finishes a parent's own render before rendering its children,
  // so any useAppSelector call in a descendant sees this value by the time
  // it runs, within the same render pass. Notifying subscribers (so THEIR
  // OWN re-renders happen) has to wait for the effect below instead --
  // you can't synchronously trigger another component's re-render
  // mid-render.
  //
  // Deliberate exception, not an oversight: react-hooks' compiler-purity
  // check flags any reassignment of a module-level variable during render
  // (the same restriction that pushed stateRef/playingRef just below onto a
  // ref+effect instead). That workaround doesn't apply here: stateRef/
  // playingRef are only ever read later, from an async engine callback, so a
  // render's assignment landing a tick late (post-commit, via effect) is
  // harmless. This mirror is read DURING render, by a descendant's
  // useAppSelector call in the very same pass -- deferring the write to an
  // effect would mean any component mounting in that pass reads stale
  // initialState instead of the real current state until the next update.
  // StoreProvider is the sole owner of this assignment (it is the app's
  // single top-level parent, mounted once) and the only thing read here is
  // `state`, itself just-computed via useReducer above -- there is no other
  // writer, so this can't race.
  //
  // This safety argument depends on StoreProvider's render body actually
  // running every time `state` changes -- true today (no compiler involved,
  // just plain React), but NOT guaranteed if this project ever enables the
  // real React Compiler (there's no babel-plugin-react-compiler here now --
  // this lint rule is a forward-looking static check, not evidence one is
  // running). The compiler's auto-memoization could bail out of re-invoking
  // this render body on an update it judges output-equivalent, silently
  // desyncing the mirror from useAppSelector reads. Re-audit this line
  // specifically before adopting the compiler.
  // eslint-disable-next-line react-hooks/globals -- see comment above
  currentState = state
  useEffect(() => {
    for (const listener of stateListeners) listener()
  }, [state])
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  // View-only (not undo-tracked, not persisted -- see ArrangerMode's own
  // "Not persisted" doc comment in store.ts for the same reasoning): resets
  // to 1 on every app launch. 24 is the base PPB (Ruler.tsx); effective PPB
  // is BASE_PPB * zoomMultiplier, computed once below rather than at every
  // call site.
  const [zoomMultiplier, setZoomMultiplier] = useState(1)
  const [masterChainStatus, setMasterChainStatus] = useState<
    [MasterChainSlotStatus, MasterChainSlotStatus, MasterChainSlotStatus, MasterChainSlotStatus]
  >(['idle', 'idle', 'idle', 'idle'])
  const [masterChainError, setMasterChainError] = useState<
    [string | null, string | null, string | null, string | null]
  >([null, null, null, null])
  const [channelChainStatus, setChannelChainStatus] = useState<
    Record<string, [MasterChainSlotStatus, MasterChainSlotStatus]>
  >({})
  const [channelChainError, setChannelChainError] = useState<
    Record<string, [string | null, string | null]>
  >({})
  const [pluginCatalog, setPluginCatalog] = useState<PluginCatalog>({
    plugins: [],
    favouriteIds: []
  })
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    void window.rifffApi.getPluginCatalog().then(setPluginCatalog)
  }, [])

  const [riffFavourites, setRiffFavourites] = useState<Set<string>>(new Set())

  useEffect(() => {
    void window.rifffApi.listRiffFavourites().then((ids) => setRiffFavourites(new Set(ids)))
  }, [])

  useEffect(() => {
    return window.rifffApi.onScanProgress((progress) => setScanProgress(progress))
  }, [])

  const triggerScan = useCallback(() => {
    setScanning(true)
    setScanProgress(null)
    void window.rifffApi.scanPlugins().then((catalog) => {
      setPluginCatalog(catalog)
      setScanning(false)
      setScanProgress(null)
    })
  }, [])

  const toggleFavourite = useCallback((id: string) => {
    void window.rifffApi.togglePluginFavourite(id).then(setPluginCatalog)
  }, [])

  const pluginCatalogActions = useMemo(
    () => ({ triggerScan, toggleFavourite }),
    [triggerScan, toggleFavourite]
  )

  const toggleRiffFavourite = useCallback((riffCID: string) => {
    void window.rifffApi.toggleRiffFavourite(riffCID).then((ids) => setRiffFavourites(new Set(ids)))
  }, [])

  const riffFavouritesActions = useMemo(() => ({ toggleRiffFavourite }), [toggleRiffFavourite])

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
      case 'SET_ZOOM':
        setZoomMultiplier(action.multiplier)
        return
      case 'RESET_ZOOM':
        setZoomMultiplier(1)
        return
      case 'LOAD_STATE':
        setPlaying(false)
        setPos(0)
        rawDispatch(action)
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
  // pendingEngineSyncRef tracks whether an rAF-scheduled flush is currently
  // pending OR in flight -- deliberately NOT cleared by this effect's own
  // cleanup function on every dependency change. This provider is the
  // app's single top-level parent, mounted exactly once for the lifetime of
  // the window (see currentState's own doc comment above) and never
  // unmounted before the whole renderer process tears down, so there's no
  // meaningful "unmount mid-flush" case to guard against here -- unlike a
  // component that can mount/unmount repeatedly. A naive `return () =>
  // cancelAnimationFrame(...)` here would cancel-and-reschedule on every
  // single dependency change; if any of the tracked fields below ever
  // change faster than once per animation frame (this effect no longer
  // tracks state.dragVol/dragFadeIn/dragFadeOut, the fields that originally
  // motivated this guard -- see docs/superpowers/specs/
  // 2026-08-04-live-param-fast-path-design.md -- but the same risk applies
  // to any future high-frequency dispatch this effect ends up depending
  // on), each new dispatch would perpetually push the flush deadline out,
  // so it would never actually fire until the changes paused for a whole
  // frame -- defeating the entire point of coalescing rather than dropping
  // updates. Guarding on this ref instead means the FIRST
  // change after being idle schedules a flush ~1 frame out; every
  // subsequent change while that flush is still pending (scheduled OR
  // in-flight) is a no-op, and the eventual flush reads stateRef.current --
  // the LATEST committed state at the moment it actually runs, not
  // whatever was captured when it was scheduled.
  const pendingEngineSyncRef = useRef(false)
  // Set whenever a dependency changes while a flush is already pending/
  // in-flight (see scheduleEngineSync below) -- catches the case a plain
  // pendingEngineSyncRef guard alone would silently drop: a change arriving
  // WHILE the current send's own async IPC round-trip (buildEngineProject's
  // rubberband resolveStretched call, then engineLoadProject) is still in
  // flight has nothing to trigger a later re-send once that call finishes,
  // since flipping a ref back to false doesn't itself cause a re-render or
  // re-run this effect. Checked in the same `finally` block that clears
  // pendingEngineSyncRef; if set, immediately schedules one more flush
  // (which will read stateRef.current fresh at THAT point, reflecting
  // whatever arrived) rather than leaving the engine on a stale mid-drag
  // value until some unrelated later edit happens to touch a tracked field.
  const dirtyEngineSyncRef = useRef(false)

  useEffect(() => {
    scheduleEngineSync()
    // No eslint-disable needed here: the effect body only calls
    // scheduleEngineSync (which itself only reads stateRef.current, a ref,
    // exempt from exhaustive-deps) rather than reading `state` directly, so
    // the linter has no missing-dependency complaint about the individual
    // state.* entries below. They're listed individually (not as a single
    // `state` dep) intentionally, matching the granularity of the original
    // effect, and intentionally exclude playing/pos (no longer part of
    // state at all); those are handled by the separate play/pause effect
    // and the position-update subscription below, not by reloading the
    // whole project.
    function scheduleEngineSync(): void {
      if (pendingEngineSyncRef.current) {
        dirtyEngineSyncRef.current = true
        return
      }
      pendingEngineSyncRef.current = true
      requestAnimationFrame(() => {
        void (async () => {
          try {
            const project = await buildEngineProject(
              stateRef.current,
              resolveStretchedForPlayback,
              pluginCatalog
            )
            await window.rifffApi.engineLoadProject(project)
          } finally {
            // Cleared only once the send actually completes (success or
            // failure) -- not at the start of the rAF callback -- so at
            // most one send is ever pending/in-flight at a time. Without
            // this, a slow send could let a second flush get scheduled and
            // fire while the first is still in flight, reintroducing the
            // exact overlapping-async-calls race the effect's own removed
            // `cancelled` flag used to guard against.
            pendingEngineSyncRef.current = false
            if (dirtyEngineSyncRef.current) {
              dirtyEngineSyncRef.current = false
              scheduleEngineSync()
            }
          }
        })()
      })
    }
  }, [
    state.off,
    state.bpm,
    state.snapIdx,
    state.stretch,
    state.rifffs,
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
    state.playedBars,
    // Same class of gap as state.playedBars above, found while building the
    // live-drag-preview feature: a committed left-crop change didn't sync
    // to the engine at all, not even on mouse-up, since this field was
    // simply never added here despite buildEngineProject.ts already reading
    // it.
    state.leftCrop,
    // dragVol/dragFadeIn/dragFadeOut deliberately NOT here -- they used to
    // be, triggering a full project reload on every drag step, which
    // turned out to cause real, audible glitching at drag frequency (see
    // docs/superpowers/specs/2026-08-04-live-param-fast-path-design.md).
    // Live volume/fade updates now go through a separate, much lighter
    // path (liveParamSync.ts's scheduleLiveParamSync, called directly from
    // the drag handlers) that bypasses this whole effect entirely. The
    // COMMITTED fields (state.vol/fadeIn/fadeOut, above) stay here
    // unchanged -- a drag's final commit still triggers exactly one full
    // reload, same as any other edit, and that reload is what eventually
    // clears the live override on the native side (see IpcServer.cpp's
    // load-project handler) -- no explicit "clear" is ever dispatched from
    // here.
    // masterChain plugin IDs flow through this general project sync (the
    // native engine's own EngineProject.masterChain field just needs to
    // stay current); actually LOADING/swapping the plugin binary is a
    // separate, explicit engineLoadMasterPlugin call below instead -- see
    // the SET_MASTER_CHAIN_PLUGIN dispatch-side effect.
    state.masterChain,
    // A catalog id only resolves to a real path once the catalog itself has
    // loaded (or been rescanned) -- without this, a masterChain slot set
    // before the catalog finished loading would be sent to the engine with
    // an empty, unresolvable path forever, never re-sent once the real path
    // became known.
    pluginCatalog,
    // channelPlugins flows through this general project sync the same way
    // masterChain's own ids already do -- actual loading/swapping is the
    // separate, explicit engineLoadChannelPlugin call in the diffing effect
    // below instead.
    state.channelPlugins,
    // channelOf determines each rifff's EngineRifff.channelId (see
    // buildEngineProject.ts), which now directly decides which channel's
    // plugin chain a rifff's audio routes through -- missing here would mean
    // dragging a clip onto a different channel doesn't actually re-route its
    // audio through that channel's chain until some OTHER tracked field
    // happens to change too, same class of bug as the SET_PLAYED_BARS gap
    // documented above.
    state.channelOf,
    // Same class of gap as state.playedBars/state.leftCrop above, just never
    // caught by RegionMute's own manual verification pass: ADD_MUTE_REGION/
    // REMOVE_MUTE_REGION update state.muteRegions fine (StemWaveformRow
    // re-renders the muted span correctly from it), but without this dep
    // this effect never re-runs to actually re-send the project — the
    // native engine keeps playing the pre-mute audio in that span until some
    // OTHER tracked field happens to change and trigger a resync first.
    state.muteRegions
  ])

  // Inbound half of the same bidirectional relationship as the outbound
  // state.bpm sync effect directly above -- kept next to it deliberately,
  // per this feature's own design (see LinkSession.h's doc comment for the
  // native side). Fires when IpcServer.cpp's link-poll timer detects a Link
  // PEER (Maschine, Ableton, etc.) changed the session tempo, and adopts it
  // into state.bpm the same way a manual TransportBar edit would.
  //
  // Feedback-loop analysis: dispatching SET_TEMPO here re-triggers the
  // outbound effect above (state.bpm changed -> rAF-scheduled
  // buildEngineProject -> engineLoadProject -> load-project ->
  // transport.setBpm -> linkSession.syncTempo(thisSameBpm)). This does NOT
  // echo back out to Link: LinkSession::checkForExternalTempoChange already
  // updated its own lastKnownSessionTempo to this exact value the moment it
  // detected the change (native-side, before this push was even sent), so
  // by the time that outbound syncTempo call lands, both
  // lastKnownSessionTempo and the incoming bpm already agree with the
  // session's own tempo -- syncTempo's own "did sssketch's tempo actually
  // differ from the session" comparison is false, so it no-ops rather than
  // committing anything back to the session. See LinkSession.cpp's
  // checkForExternalTempoChange/syncTempo for the exact comparison this
  // relies on. Uses `dispatch` (not `rawDispatch`) so this lands as a
  // normal undo-tracked edit, same as a manual TransportBar tempo commit --
  // there's no reason for a peer-driven adoption to be exempt from undo.
  useEffect(() => {
    return window.rifffApi.onLinkTempoChanged((bpm) => {
      dispatch({ type: 'SET_TEMPO', bpm })
    })
  }, [dispatch])

  useEffect(() => {
    if (playing) {
      void window.rifffApi.enginePlay(pos)
    } else {
      void window.rifffApi.engineStop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-runs on play/pause transitions, matching the old effect's behavior; pos is read once at play-start via closure, not tracked as a dependency
  }, [playing])

  useEffect(() => {
    void window.rifffApi.engineSetMetronome(state.metronomeEnabled)
  }, [state.metronomeEnabled])

  // Drives Transport's playback wrap directly from loopRegion, live, on
  // every change -- independent of whether any channel is armed (see
  // IpcServer.cpp's set-loop-region handler for the full rationale: per
  // manual-testing feedback, the loop should apply "at all times" once a
  // region is drawn, not only while recording). Cheap (an atomic store on
  // the engine side, no buffer reconstruction), so unlike ChannelRow's own
  // debounced re-arm-on-resize (which DOES need to rebuild the capture
  // buffer, and is genuinely disruptive to do on every drag tick), this
  // fires immediately on every drag-move, keeping playback tracking the
  // drag in real time. endBar<=startBar (0/0 when loopRegion is null)
  // disables wrapping.
  useEffect(() => {
    void window.rifffApi.engineSetLoopRegion(
      state.loopRegion?.startBar ?? 0,
      state.loopRegion?.endBar ?? 0
    )
  }, [state.loopRegion])

  // Diffs against the previous masterChain on every change so only the ONE
  // slot that actually changed gets reloaded -- an unrelated arrangement
  // edit elsewhere must never accidentally trigger a plugin reload/swap
  // glitch on a slot nobody touched (see the design spec's "separate,
  // explicit load-master-plugin message" rationale).
  const masterChainRef = useRef(state.masterChain)
  useEffect(() => {
    const prev = masterChainRef.current
    masterChainRef.current = state.masterChain
    state.masterChain.forEach((pluginId, slot) => {
      if (pluginId !== prev[slot]) {
        setMasterChainStatus((s) => {
          const next = [...s] as typeof s
          next[slot] = pluginId === null ? 'idle' : 'loading'
          return next
        })
        const path =
          pluginId === null
            ? null
            : (pluginCatalog.plugins.find((p) => p.id === pluginId)?.path ?? null)
        void window.rifffApi.engineLoadMasterPlugin(slot, pluginId, path)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes pluginCatalog: this effect only reacts to masterChain CHANGES (a slot's id differing from its previous value), never to the catalog itself updating around an unchanged id -- the migration effect above is what re-dispatches SET_MASTER_CHAIN_PLUGIN once a real id is known, which is what actually re-triggers this effect
  }, [state.masterChain])

  // Per-channel equivalent of the masterChainRef diffing effect above --
  // same reasoning, generalized from a fixed 4-tuple to a Record<channelId,
  // [SlotStatus, SlotStatus]> keyed by channel id.
  const channelPluginsRef = useRef(state.channelPlugins)
  useEffect(() => {
    const prev = channelPluginsRef.current
    channelPluginsRef.current = state.channelPlugins
    for (const channelId of Object.keys(state.channelPlugins)) {
      const slots = state.channelPlugins[channelId]
      const prevSlots = prev[channelId]
      slots.forEach((pluginId, slot) => {
        if (pluginId !== (prevSlots?.[slot] ?? null)) {
          setChannelChainStatus((s) => {
            const existing =
              s[channelId] ?? (['idle', 'idle'] as [MasterChainSlotStatus, MasterChainSlotStatus])
            const next = [...existing] as [MasterChainSlotStatus, MasterChainSlotStatus]
            next[slot] = pluginId === null ? 'idle' : 'loading'
            return { ...s, [channelId]: next }
          })
          const path =
            pluginId === null
              ? null
              : (pluginCatalog.plugins.find((p) => p.id === pluginId)?.path ?? null)
          void window.rifffApi.engineLoadChannelPlugin(channelId, slot, pluginId, path)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes pluginCatalog, matching the master chain's own equivalent effect's own reasoning above
  }, [state.channelPlugins])

  // Runs the old-slug-to-catalog-id migration once the scan catalog is
  // loaded -- this can't live in serialize.ts's pure deserializeProject the
  // way DAW mode's own trackOrder migration did, since it needs the
  // async-loaded plugin catalog to resolve a stale slug to a real id.
  // Reuses the existing SET_MASTER_CHAIN_PLUGIN action, no new reducer case
  // needed.
  useEffect(() => {
    if (pluginCatalog.plugins.length === 0) return // catalog not loaded yet, or never scanned
    state.masterChain.forEach((pluginId, slot) => {
      if (pluginId === null) return
      const oldPath = OLD_ALLOWLIST_SLUG_TO_PATH[pluginId]
      if (oldPath === undefined) return // not a stale slug, nothing to migrate
      const match = pluginCatalog.plugins.find((p) => p.path === oldPath)
      if (match === undefined) return // scan hasn't found it (not installed, or scan not run yet) -- leave as-is
      dispatch({ type: 'SET_MASTER_CHAIN_PLUGIN', slot: slot as 0 | 1 | 2 | 3, pluginId: match.id })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs on catalog/masterChain changes only; dispatch is stable
  }, [pluginCatalog, state.masterChain])

  useEffect(() => {
    return window.rifffApi.onMasterPluginLoaded(({ slot, pluginId, success, error }) => {
      if (!success)
        console.error(`StoreContext: master chain slot ${slot} failed to load plugin: ${error}`)
      setMasterChainStatus((s) => {
        const next = [...s] as typeof s
        // pluginId is empty for an unload request (see engineLoadMasterPlugin's
        // null-path convention) -- a successful UNLOAD must land on 'idle', not
        // 'loaded', or clearing a slot (including the auto-clear below, after a
        // failed load) leaves the status dot bright and Edit clickable for a
        // slot that's actually empty.
        next[slot] = success ? (pluginId ? 'loaded' : 'idle') : 'error'
        return next
      })
      setMasterChainError((s) => {
        const next = [...s] as typeof s
        next[slot] = success ? null : (error ?? 'unknown error')
        return next
      })
      if (!success) {
        // A failed load must not leave state.masterChain[slot] pointing at the
        // plugin id that just failed -- otherwise a later, unrelated engine
        // crash-recovery restart would keep resending load-master-plugin for
        // the same known-bad id forever. rawDispatch (not dispatch) since this
        // is plain state cleanup, not a user edit worth its own undo step; the
        // SET_MASTER_CHAIN_PLUGIN case above would also reset
        // masterChainStatus/masterChainError back to 'idle'/null and fire
        // another (pointless) engineLoadMasterPlugin IPC call right back --
        // acceptable, matches the reverted send-bus feature's own precedent.
        rawDispatch({
          type: 'SET_MASTER_CHAIN_PLUGIN',
          slot: slot as 0 | 1 | 2 | 3,
          pluginId: null
        })
      }
    })
  }, [])

  useEffect(() => {
    return window.rifffApi.onChannelPluginLoaded(
      ({ channelId, slot, pluginId, success, error }) => {
        if (!success)
          console.error(
            `StoreContext: channel "${channelId}" slot ${slot} failed to load plugin: ${error}`
          )
        setChannelChainStatus((s) => {
          const existing =
            s[channelId] ?? (['idle', 'idle'] as [MasterChainSlotStatus, MasterChainSlotStatus])
          const next = [...existing] as [MasterChainSlotStatus, MasterChainSlotStatus]
          // See onMasterPluginLoaded's own comment -- same fix, same bug: an
          // empty pluginId means this reply is for an unload, not a real load,
          // so a successful one must land on 'idle', not 'loaded'.
          next[slot] = success ? (pluginId ? 'loaded' : 'idle') : 'error'
          return { ...s, [channelId]: next }
        })
        setChannelChainError((s) => {
          const existing = s[channelId] ?? ([null, null] as [string | null, string | null])
          const next = [...existing] as [string | null, string | null]
          next[slot] = success ? null : (error ?? 'unknown error')
          return { ...s, [channelId]: next }
        })
        if (!success) {
          // Same reasoning as the master chain's own equivalent cleanup above
          // -- a failed load must not leave channelPlugins[channelId][slot]
          // pointing at the plugin id that just failed.
          rawDispatch({
            type: 'SET_CHANNEL_CHAIN_PLUGIN',
            channelId,
            slot: slot as 0 | 1,
            pluginId: null
          })
        }
      }
    )
  }, [])

  useEffect(() => {
    return window.rifffApi.onEnginePositionUpdate((pos) => {
      // The native engine's 30Hz position timer only stops once it processes
      // an in-flight 'stop' message — a tick already queued before that lands
      // anyway. Without this guard, such a straggler can dispatch a stale
      // nonzero SET_POS right after STOP just reset pos to 0, and a quick
      // Stop-then-Play could then resume from that stale position instead.
      if (!playingRef.current) return
      // Same "straggler tick already in flight" issue, for a manual seek
      // instead of a stop: a tick computed from the OLD position can still
      // be in flight over IPC when a click/drag-to-scrub dispatches the new
      // position locally, arriving just after and visibly flickering the
      // playhead back to the pre-seek spot for a frame. See manualSeek.ts's
      // own doc comment.
      if (isWithinManualSeekGrace()) return
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
        <PosCtx.Provider value={pos}>
          <PlayingCtx.Provider value={playing}>
            <ZoomCtx.Provider value={24 * zoomMultiplier}>
              <HistoryCtx.Provider value={historyControls}>
                <MasterChainStatusCtx.Provider value={masterChainStatus}>
                  <MasterChainErrorCtx.Provider value={masterChainError}>
                    <ChannelChainStatusCtx.Provider value={channelChainStatus}>
                      <ChannelChainErrorCtx.Provider value={channelChainError}>
                        <PluginCatalogCtx.Provider value={pluginCatalog}>
                          <PluginScanStateCtx.Provider value={{ scanning, progress: scanProgress }}>
                            <PluginCatalogActionsCtx.Provider value={pluginCatalogActions}>
                              <RiffFavouritesCtx.Provider value={riffFavourites}>
                                <RiffFavouritesActionsCtx.Provider value={riffFavouritesActions}>
                                  {children}
                                </RiffFavouritesActionsCtx.Provider>
                              </RiffFavouritesCtx.Provider>
                            </PluginCatalogActionsCtx.Provider>
                          </PluginScanStateCtx.Provider>
                        </PluginCatalogCtx.Provider>
                      </ChannelChainErrorCtx.Provider>
                    </ChannelChainStatusCtx.Provider>
                  </MasterChainErrorCtx.Provider>
                </MasterChainStatusCtx.Provider>
              </HistoryCtx.Provider>
            </ZoomCtx.Provider>
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

/** Subscribes to one specific slice of AppState instead of the whole
 * object -- only re-renders the calling component when THIS selector's
 * result actually changes (per isEqual, default reference equality), not
 * on every dispatch anywhere in the app. See useAppState() above for the
 * broad-read alternative, still the right tool for components whose
 * render cost doesn't multiply by project size (Inspector, Shelf,
 * TransportBar, etc.) -- this hook is for the ones that do (ChannelRow,
 * RifffBlockRow, StemWaveformRow, CollapsedRifffRow). See
 * docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md. */
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useAppSelector<T>(
  selector: (state: AppState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  return useSyncExternalStoreWithSelector(
    subscribeToState,
    getStateSnapshot,
    getStateSnapshot,
    selector,
    isEqual
  )
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
export function useZoom(): number {
  return useContext(ZoomCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useHistory(): HistoryControls {
  return useContext(HistoryCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useMasterChainStatus(): [
  MasterChainSlotStatus,
  MasterChainSlotStatus,
  MasterChainSlotStatus,
  MasterChainSlotStatus
] {
  return useContext(MasterChainStatusCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useMasterChainError(): [
  string | null,
  string | null,
  string | null,
  string | null
] {
  return useContext(MasterChainErrorCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useChannelChainStatus(): Record<
  string,
  [MasterChainSlotStatus, MasterChainSlotStatus]
> {
  return useContext(ChannelChainStatusCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useChannelChainError(): Record<string, [string | null, string | null]> {
  return useContext(ChannelChainErrorCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function usePluginCatalog(): PluginCatalog {
  return useContext(PluginCatalogCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function usePluginScanState(): {
  scanning: boolean
  progress: { done: number; total: number } | null
} {
  return useContext(PluginScanStateCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function usePluginCatalogActions(): {
  triggerScan: () => void
  toggleFavourite: (id: string) => void
} {
  return useContext(PluginCatalogActionsCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useRiffFavourites(): Set<string> {
  return useContext(RiffFavouritesCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useRiffFavouritesActions(): { toggleRiffFavourite: (riffCID: string) => void } {
  return useContext(RiffFavouritesActionsCtx)
}
