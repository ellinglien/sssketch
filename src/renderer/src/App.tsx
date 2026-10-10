import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type WheelEvent
} from 'react'
import {
  StoreProvider,
  getStateSnapshot,
  useAppSelector,
  useAppState,
  useDispatch,
  useHistory,
  usePlaying,
  usePos,
  useRestoreState,
  useZoom
} from './state/StoreContext'
import { setReonedSessionRoot } from './state/reonedInUse'
import { openWithReonedRepair } from './state/reonedRepairOnOpen'
import { reconcileReonedMissing, setReonedMissing } from './state/reonedMissing'
import { Titlebar } from './components/Titlebar'
import { TransportBar } from './components/TransportBar'
import { Ruler, PPB } from './components/Ruler'
import {
  zoomMultiplierForWheelDelta,
  scrollLeftForZoomChange,
  isVerticalDominant
} from './components/zoomMath'
import { Shelf } from './components/Shelf'
import { Inspector } from './components/Inspector'
import { ARRANGEMENT_MIXER_RAIL_WIDTH, railWheelGesture } from './components/arrangementMixerRail'
import { useScrollbarInsets } from './components/useScrollbarInsets'
import { undoRouter, undoShortcutFor } from './state/undoRouting'
import { ChannelRow } from './components/ChannelRow'
import { SketchStrip } from './components/SketchStrip'
import { CrossPanel } from './components/CrossPanel'
import { ShapePanel, type ShapeProcessRackUnit } from './components/ShapePanel'
import { rifffForSketchCross } from './components/crossFromSketch'
import { Playhead } from './components/Playhead'
import { RiserExtentGesture } from './components/RiserExtentGesture'
import { BeatPicker, bakeStems, rebakeRifff } from './components/BeatPicker'
import { LibraryBrowser } from './components/LibraryBrowser'
import { type DiscoverSlot } from './components/DiscoverPanel'
import { buildSeedSlotsFromStems, discoverHasRealContent } from './audio/discoverSeed'
import { ProjectLibraryBrowser } from './components/ProjectLibraryBrowser'
import { ClusterStemsBrowser, type TidyUpPopulation } from './components/ClusterStemsBrowser'
import { ArrangementMap } from './components/ArrangementMap'
import { AutoArrangeWizard } from './components/AutoArrangeWizard'
import { DrawArrangeWizard } from './components/DrawArrangeWizard'
import { LockInConfirmDialog } from './components/LockInConfirmDialog'
import { LoopOrOneShotPrompt, type LoopOrOneShotChoice } from './components/LoopOrOneShotPrompt'
import { importPathsWithChoice } from './audio/importPathsWithChoice'
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu'
import { DEFAULT_DISCOVER_CHAOS } from '@shared/discoverRanking'
import { ME_SELECTION, type ArtistSelection } from '@shared/artistSelection'
import { createRiser } from '@shared/riser'
import { BusyOverlay } from './components/BusyOverlay'
import { NewProjectModal } from './components/NewProjectModal'
import { loadLastProjectTempo, saveLastProjectTempo } from './state/lastProjectTempo'
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog'
import { ConfirmationDialog } from './components/ConfirmationDialog'
import { UpdateAvailableDialog } from './components/UpdateAvailableDialog'
import { TidyUpNudgeModal } from './components/TidyUpNudgeModal'
import { ExportFormatPicker } from './components/ExportFormatPicker'
import type { ToolkitExportMode } from '@shared/toolkit'
import {
  dawExportLeavesMastering,
  exportHasThrows,
  exportToolkitChoice
} from '@shared/exportToolkitChoice'
import { StemsFormatPicker } from './components/StemsFormatPicker'
import { OnboardingModal } from './components/OnboardingModal'
import { LibraryLocationModal } from './components/LibraryLocationModal'
import { TourOverlay } from './components/TourOverlay'
import { TOUR_STEPS } from '@shared/tourSteps'
import {
  libraryModeForEntryPoint,
  type LibraryEntryPoint,
  type LibraryMode
} from '@shared/libraryEntryPoints'
import { SssketchyCoach } from './components/SssketchyCoach'
import { type CoachMoveAction } from '@shared/coachSteps'
import { type CoachSlotSnapshot } from '@shared/coachClimax'
import { requestCoachTensionOp } from './state/coachTensionBridge'
import { registerCoachExport, requestCoachExport } from './state/coachExportBridge'
import type { CoachExportOp } from '@shared/coachTension'
import { BusyProvider, useBusy } from './state/BusyContext'
import { deserializeProject } from './state/serialize'
import { hasUnsavedChanges } from './state/unsavedChanges'
import { AUTO_ARRANGE_MAX_BARS } from '@shared/autoArrangeApply'
import { warmStemCaches } from './audio/warmStemCaches'
import { BackgroundFeatureScan } from './audio/BackgroundFeatureScan'
import { installBackgroundScanInteractionListeners } from './audio/backgroundScanGate'
import { DiscoverLibraryScan } from './audio/DiscoverLibraryScan'
import { BackgroundWorkIndicator } from './components/BackgroundWorkIndicator'
import { EngineStartupIndicator } from './components/EngineStartupIndicator'
import { StemsUnavailableIndicator } from './components/StemsUnavailableIndicator'
import { PluginsHeldNotice, PluginsOffNotice } from './components/PluginsOffNotice'
import { ReonedCopyMissingNotice } from './components/ReonedCopyMissingNotice'
import { ReonedCopiesNotice } from './components/ReonedCopiesNotice'
import { ReoneNotice } from './components/ReoneNotice'
import { SaveCopyNotice } from './components/SaveCopyNotice'
import { TopRightNotices } from './components/TopRightNotices'
import { showSaveCopyNotice } from './state/saveCopyNotice'
import { saveAsNewVersion } from './state/saveAsNewVersion'
import {
  SAVE_AS_NEW_VERSION_HINT,
  SAVE_AS_NEW_VERSION_LABEL,
  SAVE_COPY_TO_FILE_HINT,
  SAVE_COPY_TO_FILE_LABEL,
  copyToFileConfirmation
} from '@shared/saveCopyText'
import { showReoneNotice } from './state/reoneNotice'
import { reoneSiblings, siblingsNotReonedText } from '@shared/reoneNotices'
import {
  activeSeedPhase,
  discoverSeedPhase as seedPhaseOfStems,
  type DiscoverSeedPhase
} from '@shared/discoverSeedPhase'
import { phaseLineage } from '@shared/reonedRotation'
import { StartupGate } from './components/StartupGate'
import { OwnUsernameReporter } from './components/OwnUsernameReporter'
import { markManualSeek } from './state/manualSeek'
import { useGatedRecordingControls } from './state/useGatedRecordingControls'
import {
  loopLengthBars,
  placedTimelineSpanBars,
  pasteRifffAction,
  channelsInOrder,
  nextArrangerMode,
  isSketchEligible,
  groupIdAtPosition,
  sketchSoundingGroupId,
  resolvePlayedBars,
  resolvedPlayedBarsFromFields
} from './state/selectors'
import { initialState, SNAP_DIVS, startupState } from './state/store'
import { newProjectSeed } from '@shared/seededRandom'
import { appSoundDefaults } from './state/appSoundDefaults'
import { reducer, type AppState, type LoopRegion } from './state/store'
import { applyGrabOffset, getGrabOffsetBars } from './components/dragGrabOffset'
import { startPointerDrag } from './components/dragUtils'
import { useHandModeHeld } from './components/useHandModeHeld'
import { stemKey, type BusId, type Rifff } from '@shared/types'
import {
  createCrossDraft,
  crossParentFromRifff,
  crossProjectKey,
  type CrossDraft
} from '@shared/cross'
import {
  assembleShapeRifff,
  createShapeDraft,
  shapeContentFingerprint,
  shapeRenderSegments,
  type ShapeAssembly,
  type ShapeDraft
} from '@shared/shape'
import { stopActivePreview } from './audio/previewLoop'
import { loadSavedPreviewLevel } from './audio/previewOutput'
import { assessTidyUpReadiness, unbussedStemPaths } from '@shared/tidyUpReadiness'
import type { ArrangeRole } from '@shared/stemRole'
import { usePlacedFlatStems } from './state/usePlacedFlatStems'
import type { DiscoverSettings } from '../../main/discoverSettingsStore'
import { DEFAULT_TRAIT_BAR, nextTraitMatchBar } from '@shared/traitBar'
import { DEFAULT_RADIO_SETTINGS, radioSourceOf, type RadioSettings } from '@shared/radioSchedule'
import { DEFAULT_RADIO_VIEW, type RadioView } from '@shared/radioView'
import { mergeLatestSettings, nestedPatchFromLatest } from '@shared/latestSettings'
import { pickBestRifffForReOne } from '@shared/reOneScoring'
import { useFeatureEnabled } from './state/appFeatures'
import {
  pendingPluginStatesGeneration,
  pendingPluginStatesRef,
  pluginCaptureFallback,
  pluginSwitchStateRef,
  recordPluginCapture,
  replacePendingPluginStates
} from './state/pendingPluginStates'
import {
  autosaveAction,
  autosaveWaitsOnRecoveryOffer,
  recoverySnapshotHasContent,
  autosaveDelayMs,
  createAutosaveGate,
  dirtyCheckJson,
  liveSettingsForSave,
  projectJsonForSave,
  saveCompletionIsCurrent,
  saveOutcomeNotice,
  type SaveOutcome
} from './state/saveSerialization'
import { createPublishGate } from './state/publishGate'
import { slotsEngineHolds } from '@shared/pluginSwitch'
import type { PluginStatesMap } from '@shared/pluginStates'
import {
  clearPluginsTouched,
  markPluginsTouched,
  pluginsTouchedSnapshot,
  usePluginsTouched
} from './state/pluginsTouched'

function shapeProjectKey(sessionEpoch: string): string {
  // Shape belongs to the in-memory editing session, not to its current file
  // name/path. Rename, first Save and Save As may change storage identity
  // without replacing the music under the editor.
  return sessionEpoch
}

/** Tracks what the currently-open project actually is, so Save/Export know
 * whether to write in place (no dialog) or fall back to the existing
 * dialog-based path:
 * - `null`: untitled, never saved this session -- first Save creates a
 *   fresh library entry.
 * - `{ kind: 'library', name }`: a library-resident sketch -- routine
 *   Save/Export both write in place to that sketch's own folder.
 * - `{ kind: 'external', path }`: opened via the legacy "open" dialog from
 *   outside the library -- routine Save writes in place to that exact
 *   path (no dialog needed, the path is already known), but Export falls
 *   back to the dialog-based exportAbleton, since there's no library
 *   folder structure to write an Ableton export into.
 * See docs/superpowers/specs/2026-08-05-project-library-design.md. */
type CurrentSketch = { kind: 'library'; name: string } | { kind: 'external'; path: string } | null

function barForClientX(clientX: number, container: HTMLDivElement, ppb: number): number {
  const rect = container.getBoundingClientRect()
  const xInTimeline = clientX - rect.left
  return Math.max(0, Math.round(xInTimeline / ppb))
}

// Reserved empty rows always trailing the last placed rifff, so there's a
// real, hoverable drop target below the arrangement (not just empty page
// background) and it's visually obvious that dragging a rifff there — not
// just onto an existing row — adds it to the arrangement. Purely a visual/
// hit-target affordance: dropping on any one of them is identical to
// dropping on the timeline background anywhere else (handleDrop below
// doesn't know or care which row, ghost or real, the cursor happened to be
// over — only the horizontal drop position matters).
const GHOST_ROW_COUNT = 3
const GHOST_ROW_HEIGHT = 44

// No Node `path` module in the renderer -- a plain string split covers what
// this needs (an externally-opened sketch's own file name, sans its project
// extension, as an Ableton export's default suggested filename).
/** An open that failed after openWithReonedRepair set the new project's missing copies: the
 * project in the store (the previous one, or the new one if it got that far) keeps only the
 * entries it names, so the pill and the retry never chase another project's copies. */
function reonedOpenFailed(): void {
  reconcileReonedMissing(getStateSnapshot().rifffs)
}

function basenameWithoutProjectExt(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  return base.replace(/\.sssketchproj$/i, '')
}

// Always-present trailing empty bars past the arrangement's actual loop end —
// horizontal counterpart to GHOST_ROW_COUNT above. Display-only: added to
// loopLengthBars(state) just for the Ruler's rendered width, never to
// loopLengthBars itself, which also drives the real playback loop boundary
// (StoreContext.tsx) and export duration (nativeExport.ts) — padding those
// would silently add 4 bars of real silence to every export.
const TRAILING_BLANK_BARS = 4

function Timeline({
  onOpenClipMenu,
  onOpenRiserMenu,
  onOpenPasteMenu,
  onBackgroundMouseDown,
  riserArm,
  onCancelRiserArm,
  onCreateRiser,
  openRiserLaneId,
  onCloseRiserLane,
  selectedRiffIds,
  riffSelectionAnchorId,
  onRiffSelectionChange,
  hoveredRiffKey,
  onRiffHover
}: {
  onOpenClipMenu: (x: number, y: number, groupId: string) => void
  onOpenRiserMenu: (x: number, y: number, riserId: string) => void
  /** Opens the arranger's own background menu -- paste, and "add riser
   * here" when the right-click landed on a real channel row. `channelId` is
   * null for a right-click on the empty space below the rows, where the
   * menu instead offers a riser on a brand new row of its own. */
  onOpenPasteMenu: (x: number, y: number, bar: number, channelId: string | null) => void
  /** Set while "add riser here" has been chosen but the extent drag that
   * actually creates it hasn't happened yet -- see RiserExtentGesture. Null
   * the rest of the time, which is almost always. */
  riserArm: { channelId: string; isNewRow: boolean } | null
  onCancelRiserArm: () => void
  onCreateRiser: (startBar: number, lengthBars: number) => void
  /** The one riser whose automation lane is open IN PLACE, regardless of the
   * app's own mode -- the riser that was just drawn. See Frame's own
   * openRiserLaneId. */
  openRiserLaneId: string | null
  onCloseRiserLane: () => void
  selectedRiffIds: ReadonlySet<string>
  riffSelectionAnchorId: string | null
  onRiffSelectionChange: (groupIds: Set<string>, anchorId: string | null) => void
  hoveredRiffKey: string | null
  onRiffHover: (correspondenceKey: string | null) => void
  /** Fires for every mousedown anywhere in the timeline's content area,
   * including on a clip — the caller (Frame) is the one that checks
   * e.metaKey and whether the mousedown landed on a `[data-rifff-clip]`
   * surface to decide whether this specific mousedown should start a
   * Cmd+drag pan (only true for a plain background mousedown, never one
   * that lands on a clip, which has its own separate Cmd+drag-to-duplicate
   * via native HTML5 drag). */
  onBackgroundMouseDown: (e: MouseEvent<HTMLDivElement>) => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const [dropBar, setDropBar] = useState<number | null>(null)
  const ppb = useZoom()
  // Set whenever a real Finder drop lands and needs LoopOrOneShotPrompt's
  // own "one-shot or loop?" answer before resolveDrop can finish importing
  // -- see resolveDrop's own external-file branch below. dropPromptResolveRef
  // holds the Promise resolver resolveDrop is currently awaiting, so the
  // rendered prompt's onResolve can hand the answer back into that async
  // function exactly where it paused.
  const [dropPromptPaths, setDropPromptPaths] = useState<string[] | null>(null)
  const dropPromptResolveRef = useRef<((choice: LoopOrOneShotChoice) => void) | null>(null)
  const loopRegion = useAppSelector((s) => s.loopRegion)
  // Lets resolveDrop/handleDropOnChannel below read the LATEST state at
  // call time without closing over the reactive `state` variable itself --
  // that's what makes it possible to wrap them in useCallback with a
  // stable identity (deps that don't change on every dispatch), which in
  // turn is what lets React.memo(ChannelRow) actually skip re-rendering a
  // channel untouched by a given dispatch. Closing over `state` directly
  // would make useCallback's reference change every render anyway (a new
  // `state` object every dispatch), defeating the point -- same "read
  // latest via ref, not via reactive closure" pattern StoreContext.tsx's
  // own stateRef already uses for the same reason (there, for engine
  // callbacks; here, for a memoized child's props).
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // channelsInOrder rebuilds a Map plus fresh arrays every call -- Timeline
  // re-renders on every dispatch (useAppState subscribes to the whole
  // AppState), so without this it was doing that rebuild on every mute
  // toggle, volume drag tick, plugin selection, etc., not just the state
  // changes that actually affect channel membership/order.
  const channels = useMemo(
    () => channelsInOrder(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed to the only fields channelsInOrder actually reads; depending on `state` itself would recompute on every dispatch (a new object every time), defeating the point. tidiedView/busOf are read only by the tidied-view branch (see selectors.ts), but still need to be here unconditionally -- this array can't itself branch on which mode is active.
    [state.rifffs, state.channelOf, state.channelOrder, state.tidiedView, state.busOf]
  )

  // Click anywhere in the arranger that isn't a clip (a stem waveform
  // already scrubs via its own click handler, computing basically the same
  // position — this just covers everywhere else: ghost rows, the empty
  // space past the last placed rifff, gaps within a row before/after a
  // clip) moves the playhead there — free/unsnapped, same convention as
  // Ruler's own click-to-scrub. Bubbles up from any descendant that doesn't
  // stop propagation, so RifffBlockRow's own name bar (expand/collapse, not
  // a scrub) explicitly stops it — everything else either already computes
  // the same position anyway or is a low-risk edge case (a bare click, no
  // drag, on a 5px resize handle).
  function handleBackgroundClick(e: MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const bar = Math.max(0, (e.clientX - rect.left) / ppb)
    dispatch({ type: 'SET_POS', pos: bar })
    if (playing) {
      markManualSeek()
      void window.rifffApi.engineSetPosition(bar)
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDropBar(applyGrabOffset(barForClientX(e.clientX, e.currentTarget, ppb), getGrabOffsetBars()))
    // Cmd/Ctrl-drag duplicates a placed clip instead of moving it (see
    // handleDrop's text/rifff-group-id branch) — this just gives the OS its
    // own native "copy" cursor treatment (a green + badge on macOS) while
    // the modifier is held, matching how Finder/most other drag-and-drop
    // apps signal the same thing.
    e.dataTransfer.dropEffect = e.metaKey || e.ctrlKey ? 'copy' : 'move'
  }

  // Shared by both drop entry points below — targetChannelId is the specific
  // channel the drop landed on (a real ChannelRow), or undefined (the
  // Timeline container's own fallback: a ghost row, or any other background
  // space) meaning "give this clip its own brand new channel."
  //
  // Wrapped in useCallback, reading state via stateRef.current rather than
  // closing over the reactive `state` variable -- see stateRef's own doc
  // comment above for why (this is what lets handleDropOnChannel below stay
  // referentially stable, which React.memo(ChannelRow) depends on).
  const resolveDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>, targetChannelId: string | undefined): Promise<void> => {
      e.preventDefault()
      e.stopPropagation()
      setDropBar(null)
      const state = stateRef.current
      // Tidied view's rows are a computed overlay (see selectors.ts's
      // tidiedChannelsInOrder) -- their channelIds are synthetic and were
      // never written to state.channelOf/channelOrder, so letting a drop
      // reach MOVE_TO_CHANNEL here would either silently do nothing useful
      // or (worse) write a bogus "tidied:drums:0"-style channelId into real
      // state. Flip back to the normal view to edit.
      if (state.tidiedView) return
      const startBar = applyGrabOffset(
        barForClientX(e.clientX, e.currentTarget, ppb),
        getGrabOffsetBars()
      )

      // From the shelf — either the rifff's first-ever placement, or (if it's
      // already placed elsewhere) an independent copy, never a reposition of an
      // existing clip (that's 'text/rifff-group-id', below).
      const shelfSourceId = e.dataTransfer.getData('text/rifff-shelf-source-id')
      if (shelfSourceId) {
        const source = state.rifffs[shelfSourceId]
        if (!source) return
        if (source.startBar === undefined) {
          const channelId = targetChannelId ?? crypto.randomUUID()
          dispatch({ type: 'MOVE_TO_CHANNEL', groupId: shelfSourceId, startBar, channelId })
        } else {
          const action = pasteRifffAction(state, shelfSourceId, startBar)
          if (action) dispatch(action)
        }
        return
      }

      const groupId = e.dataTransfer.getData('text/rifff-group-id')
      if (!groupId) {
        // A real Finder drop, not an internal rifff drag -- each dropped file
        // becomes its own independent placed clip. Sharing targetChannelId
        // (if any) means several files dropped together on an existing
        // ChannelRow all land on that same channel; dropping on empty/ghost
        // space instead calls crypto.randomUUID() fresh per file, giving
        // each its own new channel -- same rule already used for a single
        // internal-drag drop above, just applied per file. See
        // docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md.
        //
        // Whether these files are one-shot hits or real loops can't be told
        // apart automatically (no audio-content bpm/beat detection anywhere
        // in this codebase) -- same LoopOrOneShotPrompt Shelf.tsx's own drop
        // handler shows, asked here too (direct follow-up, 2026-09-16: "can
        // you do the same thing for files dragged onto the timeline"). This
        // async function is genuinely paused here until the rendered prompt
        // below calls dropPromptResolveRef.current with the user's answer.
        const files = Array.from(e.dataTransfer.files)
        if (files.length === 0) return
        const paths = files.map((file) => window.rifffApi.getPathForFile(file))
        const choice = await new Promise<LoopOrOneShotChoice>((resolve) => {
          dropPromptResolveRef.current = resolve
          setDropPromptPaths(paths)
        })
        setDropPromptPaths(null)
        const rifffs = await importPathsWithChoice(paths, choice)
        for (const rifff of rifffs) {
          dispatch({ type: 'ADD_TO_SHELF', rifff })
          const channelId = targetChannelId ?? crypto.randomUUID()
          dispatch({ type: 'MOVE_TO_CHANNEL', groupId: rifff.groupId, startBar, channelId })
        }
        return
      }
      // Cmd/Ctrl held at drop = duplicate rather than move: same
      // pasteRifffAction already used for "drag an already-placed shelf item
      // to a new spot" above, leaving the original exactly where it was and
      // dropping an independent copy at the new position instead.
      if (e.metaKey || e.ctrlKey) {
        const action = pasteRifffAction(state, groupId, startBar)
        if (action) dispatch(action)
        return
      }
      const channelId = targetChannelId ?? state.channelOf[groupId] ?? crypto.randomUUID()
      dispatch({ type: 'MOVE_TO_CHANNEL', groupId, startBar, channelId })
    },
    [ppb, dispatch]
  )

  // The Timeline container's own catch-all — fires for anything a specific
  // ChannelRow's own onDrop (below) didn't already stop propagation for:
  // ghost rows, or any other background space. Always resolves to "give
  // this clip a brand new channel" (targetChannelId undefined).
  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    void resolveDrop(e, undefined)
  }

  // Passed to every ChannelRow — a drop that lands there always means
  // "reassign to (or land initially on) THIS channel." Wrapped in
  // useCallback (depending only on the already-stable resolveDrop) so this
  // stays referentially stable across renders too -- see resolveDrop's own
  // doc comment for why that matters.
  const handleDropOnChannel = useCallback(
    (e: DragEvent<HTMLDivElement>, channelId: string) => {
      void resolveDrop(e, channelId)
    },
    [resolveDrop]
  )

  function handleContextMenu(e: MouseEvent<HTMLDivElement>): void {
    // Only reached for empty timeline space — RifffBlockRow's clip (and
    // RiserBlock) stop propagation before this bubbles up, so a right-click
    // on an actual element never also triggers this menu.
    e.preventDefault()
    // Which row was clicked, read off the DOM rather than threaded through
    // props: ChannelRow already marks itself with data-channel-id (the drop
    // handler's own convention), and this menu is the one place that needs
    // to know "which row is under the cursor" without the row itself having
    // handled the event.
    const channelId =
      (e.target as HTMLElement | null)
        ?.closest?.('[data-channel-id]')
        ?.getAttribute('data-channel-id') ?? null
    onOpenPasteMenu(e.clientX, e.clientY, barForClientX(e.clientX, e.currentTarget, ppb), channelId)
  }

  // Ruler's own manual drag-to-set (or double-click-to-clear) loop region --
  // distinct from targetRifffForRecording's programmatic SET_LOOP_REGION when
  // double-clicking a rifff to gate-record onto it (useGatedRecordingControls.ts).
  // A manual drag here always means "record standalone starting here," which
  // is incompatible with a stale gatedRecordingTargetGroupId left pinned from
  // an earlier double-click: enableGatedRecording/lockInGatedRecording both
  // treat a non-null target as "attach the take onto that rifff," so without
  // clearing it here a manual drag after a double-click would silently
  // capture over the WRONG span (and tempo-compensate against the wrong
  // rifff's bpm) instead of the standalone-channel behavior the design doc
  // guarantees for this path (docs/superpowers/specs/2026-08-06-rifff-recording-design.md).
  // targetRifffForRecording's own re-click-same-target refresh case
  // deliberately dispatches SET_LOOP_REGION alone (without touching the
  // target) — that's a different call site, so clearing the target here
  // doesn't interfere with it.
  function handleSetLoopRegion(region: LoopRegion): void {
    dispatch({ type: 'SET_LOOP_REGION', region })
    if (state.gatedRecordingTargetGroupId) {
      dispatch({ type: 'SET_GATED_RECORDING_TARGET', groupId: null })
    }
  }

  if (state.mode === 'sketch') {
    return (
      <SketchStrip
        selectedRiffIds={selectedRiffIds}
        selectionAnchorId={riffSelectionAnchorId}
        onSelectionChange={onRiffSelectionChange}
        hoveredRiffKey={hoveredRiffKey}
        onRiffHover={onRiffHover}
      />
    )
  }

  const ghostRowHeight = GHOST_ROW_HEIGHT
  // Matches Ruler's own width exactly (both derive from the same bar count
  // and ppb) -- without an explicit width here, this div (and therefore
  // every ChannelRow inside it, since none of them are flex/grid items)
  // is only ever as wide as its CONTAINING block, because every clip inside
  // a ChannelRow is positioned via position:absolute and so contributes
  // nothing to normal-flow sizing. That left each ChannelRow's sticky m/s/fx
  // button stack (position:sticky; right:0) pinned to a containing block no
  // wider than the viewport's own un-zoomed width -- correct at ppb's
  // default scale where content rarely exceeded the viewport, but visibly
  // wrong once zooming in made the real scrollable content much wider than
  // that: the buttons stuck at the edge of the (too-narrow) row box instead
  // of tracking the actual visible viewport, appearing to "jump left" over
  // whatever clip happened to sit near that stale boundary. Setting this
  // width explicitly (redundant with Ruler's own width, but that's fine --
  // it's the source of truth for "how wide is the whole timeline") gives
  // every child the correct wide containing block. That alone wasn't enough
  // for the sticky stack, though: a full-width sticky box fills its row and
  // can't move, so the controls sat at the timeline's END. MixerRailAnchor
  // makes it zero-width at the row's end, which is what lets it slide to the
  // viewport's right edge (the mixer rail).
  //
  // minWidth:'100%' alongside the explicit width (rather than just the
  // explicit width alone) keeps this filling the full viewport on a short
  // project too -- min-width always wins over a smaller width per CSS,
  // effectively Math.max(timelineWidthPx, viewport width) -- so the
  // background click-to-scrub area and the ghost rows below the last
  // channel still stretch to fill the visible arranger exactly as before,
  // rather than leaving a dead gap once a short project's real content
  // width is narrower than the viewport.
  const timelineWidthPx = (loopLengthBars(state) + TRAILING_BLANK_BARS) * ppb

  return (
    <div
      data-timeline
      onDragOver={handleDragOver}
      onDragLeave={() => setDropBar(null)}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      onClick={handleBackgroundClick}
      onMouseDown={onBackgroundMouseDown}
      style={{ position: 'relative', width: timelineWidthPx, minWidth: '100%' }}
    >
      <Ruler
        bars={loopLengthBars(state) + TRAILING_BLANK_BARS}
        ppb={ppb}
        loopRegion={loopRegion}
        onSetLoopRegion={handleSetLoopRegion}
      />
      {channels.map((channel) => (
        <ChannelRow
          key={channel.channelId}
          channelId={channel.channelId}
          rifffs={channel.rifffs}
          bus={channel.bus}
          onOpenContextMenu={onOpenClipMenu}
          onOpenRiserMenu={onOpenRiserMenu}
          onDropOnChannel={handleDropOnChannel}
          openRiserLaneId={openRiserLaneId}
          onCloseRiserLane={onCloseRiserLane}
        />
      ))}
      {Array.from({ length: GHOST_ROW_COUNT }, (_, i) => (
        <div
          key={`ghost-${i}`}
          style={{
            height: ghostRowHeight,
            borderBottom: '1px dashed var(--ra-border)'
          }}
        />
      ))}
      <Playhead ppb={ppb} />
      {riserArm && (
        // Rendered LAST of the arranger's own layers (above every row, the
        // ghost rows and the playhead) so that, while armed, the whole
        // arranger is one drawing surface -- a press anywhere in it belongs
        // to this gesture rather than to whatever clip happens to be under
        // the cursor. It is only mounted for the few seconds the gesture
        // lasts.
        <RiserExtentGesture
          channelId={riserArm.channelId}
          isNewRow={riserArm.isNewRow}
          onCancel={onCancelRiserArm}
          onCreate={onCreateRiser}
        />
      )}
      {dropPromptPaths && (
        <LoopOrOneShotPrompt
          paths={dropPromptPaths}
          onResolve={(choice) => dropPromptResolveRef.current?.(choice)}
        />
      )}
      {dropBar !== null && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: dropBar * ppb,
            width: 2,
            background: 'var(--ra-play-on)',
            pointerEvents: 'none',
            zIndex: 5
          }}
        />
      )}
    </div>
  )
}

type ExportFormat = 'ableton' | 'reaper' | 'stems' | 'stemTracks'

/** A chosen export, including what the user said to do with the built-in
 * toolkit. Carried as a pair (rather than two useStates) because the tidy-up
 * nudge can defer a whole export and then run it later -- and an export that
 * came back from that detour with its toolkit mode lost would silently bake a
 * project the user asked to get envelopes for. `toolkitMode` is meaningless
 * for the two stems variants, which are audio and always fully baked. */
interface PendingExport {
  format: ExportFormat
  toolkitMode: ToolkitExportMode
  /** Bus assignments implied by roles the user already confirmed, for stems
   * this project never assigned a bus to -- see assessTidyUpReadiness
   * (shared/tidyUpReadiness.ts). Carried through the nudge so an "export
   * anyway" still uses whatever the app does know. */
  derivedBusOf: Record<string, BusId>
}

function ProjectMenu({
  currentSketch,
  setCurrentSketch,
  handleNew,
  handleSave,
  serializeForSave,
  markSaved,
  onOpenLibrary,
  onOpenClusterStems,
  onOpenClusterStemsLibrary,
  onOpenAutoArrange,
  onOpenDrawArrange
}: {
  currentSketch: CurrentSketch
  setCurrentSketch: (sketch: CurrentSketch) => void
  /** Owned by App.tsx's Frame -- the only place that knows every "this
   * content is now durably saved" moment (initial load/recovery, explicit
   * Save/Cmd+S, the quit-time save prompt) and the only place that can run
   * the shared discard-guard (Frame also owns confirmDiscardIfDirty).
   * ProjectMenu itself is purely presentational for these two. */
  handleNew: () => Promise<void>
  handleSave: () => Promise<boolean>
  /** Frame's serializeForSave: the JSON every save path writes, plugin
   * settings included (saveSerialization.ts). */
  serializeForSave: () => Promise<string>
  /** Records the live project as saved (the unsaved-changes baseline).
   * `pluginsTouchedVersion`: pluginsTouched.ts's version when the save
   * started (a plugin touched since stays unsaved). */
  markSaved: (pluginsTouchedVersion: number) => void
  onOpenLibrary: () => void
  /** Opens the "tidy up" browser -- the same callback TransportBar.tsx's
   * own tidy-up button already uses (wired to setClusterStemsOpen(true) in
   * App.tsx's Frame). Reused here for the export-time nudge's "tidy up
   * first" button. */
  onOpenClusterStems: () => void
  /** Opens the same browser over the whole LIBRARY instead of this
   * sketch's stems -- not clustered, role only, no bus. See
   * TidyUpPopulation (ClusterStemsBrowser.tsx) for why the same click does
   * slightly different work in the two populations. */
  onOpenClusterStemsLibrary: () => void
  /** Opens AutoArrangeWizard -- project-wide, same "no groupId" shape as
   * onOpenClusterStems above, wired to setAutoArrangeOpen(true) in Frame. */
  onOpenAutoArrange: () => void
  /** Opens DrawArrangeWizard -- Draw Arrangement's own equivalent of
   * onOpenAutoArrange above, wired to setDrawArrangeOpen(true) in Frame. */
  onOpenDrawArrange: () => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  // Every stem on the timeline, which is exactly the population the
  // exporters pack (buildAlsXml.ts filters `startBar !== undefined` the same
  // way) and therefore exactly the population the tidy-up gate must judge.
  const { flatStems } = usePlacedFlatStems()
  const [exporting, setExporting] = useState(false)
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const [saveMenu, setSaveMenu] = useState<{ x: number; y: number } | null>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  // Moved here from TransportBar.tsx (per direct request: a top-row button
  // to the left of export, rather than buried in the transport bar) --
  // internally still called gearMenu, a pre-existing misnomer carried over
  // from TransportBar.tsx (scoped to tidy-up options only, not a general
  // settings surface).
  const [gearMenu, setGearMenu] = useState<{ x: number; y: number } | null>(null)
  const gearButtonRef = useRef<HTMLButtonElement>(null)
  const [tidyUpNudgeOpen, setTidyUpNudgeOpen] = useState(false)
  const [pendingExport, setPendingExport] = useState<PendingExport | null>(null)
  const [exportFormatPickerOpen, setExportFormatPickerOpen] = useState(false)
  const [stemsFormatPickerOpen, setStemsFormatPickerOpen] = useState(false)

  /** The spec's "the project is marked 'V1 exported'". Only ever called
   * when an export really wrote something: the dialog-based IPC calls
   * return null when the save panel was cancelled, and the library /
   * next-to-source ones return void because they always write. Harmless
   * with no flow in progress -- the reducer ignores every coach action
   * then -- and set once, because a later export is another export rather
   * than another v1 (markCoachV1Exported). */
  function markV1Exported(): void {
    if (state.coach === null) return
    dispatch({ type: 'COACH_MARK_V1_EXPORTED', now: Date.now() })
  }

  // "Export V1: the existing export picker (mixdown / Ableton / REAPER /
  // stems)" (spec). The flow opens the SAME three menu entries rather than
  // owning an export path of its own -- see coachExportBridge.ts.
  //
  // Deliberately with no dependency array: handleExportMix is a plain
  // function redeclared every render and closes over the current `state`,
  // so re-registering each render is what keeps the handler pointing at the
  // live export. The registration is a single assignment and its teardown
  // is guarded (`if (handler === next)`), so this is cheap and safe.
  useEffect(() => {
    return registerCoachExport((op: CoachExportOp): void => {
      if (op === 'mix') {
        void handleExportMix()
        return
      }
      if (op === 'stems') {
        setStemsFormatPickerOpen(true)
        return
      }
      setExportFormatPickerOpen(true)
    })
  })

  async function handleSaveCopyElsewhere(): Promise<void> {
    try {
      // Writes a copy and changes nothing about the project you're in: no
      // switch, and it stays exactly as saved or unsaved as it was.
      const written = await window.rifffApi.saveProject(await serializeForSave())
      if (written === null) return
      const currentName =
        currentSketch === null
          ? null
          : currentSketch.kind === 'library'
            ? currentSketch.name
            : basenameWithoutProjectExt(currentSketch.path)
      showSaveCopyNotice(copyToFileConfirmation(written, currentName))
    } catch (err) {
      console.error('ProjectMenu: failed to save a copy elsewhere:', err)
      window.alert(`save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleDuplicateAsNewVersion(): Promise<void> {
    if (currentSketch === null || currentSketch.kind !== 'library') return
    // Saves the original first, as save does, then writes the same project as the next numbered
    // version and moves you into it (state/saveAsNewVersion.ts). A failed save makes no copy.
    const touchedVersion = pluginsTouchedSnapshot().version
    const outcome = await saveAsNewVersion(currentSketch.name, {
      serialize: () => serializeForSave(),
      saveOriginal: (name, json) => window.rifffApi.saveProjectToLibrary(name, json),
      writeCopy: (name, json) => window.rifffApi.duplicateSketch(name, json)
    })
    if (outcome.kind === 'save-failed') {
      window.alert(outcome.alert)
      return
    }
    if (outcome.kind === 'copy-failed') {
      // The original's save landed: it counts as saved, and you stay in it.
      markSaved(touchedVersion)
      window.alert(outcome.alert)
      return
    }
    setCurrentSketch({ kind: 'library', name: outcome.copyName })
    markSaved(touchedVersion)
    showSaveCopyNotice(outcome.notice)
  }

  async function handleExportMix(): Promise<void> {
    setExporting(true)
    try {
      const wav = await window.rifffApi.exportMixNative(JSON.stringify(state))
      const defaultName =
        currentSketch !== null && currentSketch.kind === 'library'
          ? currentSketch.name
          : currentSketch !== null && currentSketch.kind === 'external'
            ? basenameWithoutProjectExt(currentSketch.path)
            : await window.rifffApi.generateDefaultProjectName()
      // null means the save panel was cancelled, so no file came out and
      // there is no v1 to mark.
      const written = await window.rifffApi.exportMix(wav, defaultName)
      if (written !== null) markV1Exported()
    } catch (err) {
      console.error('ProjectMenu: failed to export mix:', err)
      // Export now has exactly one code path (the native engine, with no Web
      // Audio fallback) — a spawn/render failure here would otherwise reset
      // the button with zero visible indication anything went wrong.
      window.alert(`export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  /**
   * `derivedBusOf` is the "it should use that information" half of the
   * tidy-up fix (see handleExportProject below). Every exporter reads
   * `state.busOf[key] ?? 'aux'` -- buildAlsXml.ts, buildRppProject.ts,
   * nativeExport.ts -- so a project whose stems were only ever ROLE-
   * confirmed (the auto-arrange route, which never writes busOf) would pile
   * every stem onto the aux bus. Merging the role-derived buses in here,
   * rather than dispatching ASSIGN_STEMS_TO_BUS, keeps exporting a
   * read-only act: no clip renames (renameRifffsForBusAssignment), no
   * unsaved-changes flag, nothing about the project moves because a file
   * was written. A real assignment always wins -- it was chosen for THIS
   * project, where the role is a fact about the file.
   */
  async function runExportProject(
    format: ExportFormat,
    toolkitMode: ToolkitExportMode = 'bake',
    derivedBusOf: Record<string, BusId> = {}
  ): Promise<void> {
    const stateJson = JSON.stringify(
      Object.keys(derivedBusOf).length === 0
        ? state
        : { ...state, busOf: { ...derivedBusOf, ...state.busOf } }
    )
    setExporting(true)
    // "did a file really come out" -- the only thing that may mark a v1.
    // The library / next-to-source calls return void because they always
    // write; the three save-dialog ones return null when the panel was
    // cancelled. The Ableton-overwrite `return` below leaves this false, so
    // declining that prompt marks nothing.
    let wrote = false
    try {
      if (currentSketch !== null && currentSketch.kind === 'library') {
        if (format === 'ableton') {
          const warn = await window.rifffApi.shouldWarnBeforeAbletonOverwrite(currentSketch.name)
          if (
            warn &&
            !window.confirm(
              "this sketch's ableton export has been modified since the last export from sssketch (likely from mixing directly in ableton). exporting again will overwrite it. continue?"
            )
          ) {
            return
          }
          await window.rifffApi.exportAlsToLibrary(stateJson, currentSketch.name, toolkitMode)
          wrote = true
        } else if (format === 'reaper') {
          await window.rifffApi.exportRppToLibrary(stateJson, currentSketch.name, toolkitMode)
          wrote = true
        } else if (format === 'stemTracks') {
          await window.rifffApi.exportStemTracksToLibrary(stateJson, currentSketch.name)
          wrote = true
        } else {
          await window.rifffApi.exportStemsToLibrary(stateJson, currentSketch.name)
          wrote = true
        }
      } else if (currentSketch !== null && currentSketch.kind === 'external') {
        if (format === 'ableton') {
          await window.rifffApi.exportAlsNextToSource(stateJson, currentSketch.path, toolkitMode)
          wrote = true
        } else if (format === 'reaper') {
          await window.rifffApi.exportRppNextToSource(stateJson, currentSketch.path, toolkitMode)
          wrote = true
        } else if (format === 'stemTracks') {
          await window.rifffApi.exportStemTracksNextToSource(stateJson, currentSketch.path)
          wrote = true
        } else {
          await window.rifffApi.exportStemsNextToSource(stateJson, currentSketch.path)
          wrote = true
        }
      } else {
        // currentSketch === null: nothing saved yet, no real location to
        // export next to -- Ableton/Reaper fall back to a save dialog
        // (same as before); both stems variants already have their own
        // dialog-based folder picker as their fallback.
        if (format === 'ableton') {
          const defaultName = await window.rifffApi.generateDefaultProjectName()
          const path = await window.rifffApi.exportAls(stateJson, defaultName, toolkitMode)
          wrote = path !== null
        } else if (format === 'reaper') {
          const defaultName = await window.rifffApi.generateDefaultProjectName()
          const path = await window.rifffApi.exportRpp(stateJson, defaultName, toolkitMode)
          wrote = path !== null
        } else if (format === 'stemTracks') {
          // exportStemTracksNative's filenames embed the project name
          // directly, unlike exportAls/exportRpp's optional save-dialog
          // suggestion -- so it's always generated here, not optional.
          const defaultName = await window.rifffApi.generateDefaultProjectName()
          const path = await window.rifffApi.exportStemTracksNative(stateJson, defaultName)
          wrote = path !== null
        } else {
          const path = await window.rifffApi.exportStemsNative(stateJson)
          wrote = path !== null
        }
      }
      if (wrote) markV1Exported()
    } catch (err) {
      console.error(`ProjectMenu: failed to export (${format}):`, err)
      window.alert(`export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  /**
   * The tidy-up gate. It used to ask `Object.keys(state.busOf).length === 0`
   * -- "has Tidy Up been run on this project" -- when the question it means
   * is "does the app know what these stems are". Since the role merge
   * (docs/superpowers/specs/2026-09-23-what-is-this-stem-design.md) a
   * confirmed ArrangeRole is the canonical answer to that and it is global,
   * so the auto-arrange role step answers it in full while leaving busOf
   * untouched -- and the user got nagged for work he had already done
   * (2026-09-23). The rule now lives in assessTidyUpReadiness
   * (shared/tidyUpReadiness.ts), where it is tested.
   *
   * HOW IT GETS ITS ANSWER, and why export does not always pay for a
   * database round trip: the roles live in the main process (the
   * StemCategories table, read through get-stem-category-roles), and
   * ArrangementMap/AutoArrangeRoleStep read them through
   * useConfirmedStemRoles -- a hook, fetching on render. Export is a click,
   * not a render, so this does NOT use that hook. Mounting it here would
   * fire an IPC read of every placed stem on every project edit, forever,
   * to answer a question asked only when somebody exports; and a hook's
   * value can still be the initial empty map at the moment of the click,
   * which would nag exactly the user this is meant to stop nagging.
   *
   * Instead the read happens at the click, and only when it can change the
   * outcome: a stem that already has a bus is already answered, so a fully
   * tidied project asks for nothing at all and exports with zero added
   * latency (unbussedStemPaths returns []). The one query is a chunked
   * IN-list over distinct paths, never one per stem. A failed read falls
   * through to the old behaviour -- treat the roles as unknown, and nudge
   * -- rather than silently exporting an untidied project.
   */
  async function handleExportProject(
    format: ExportFormat,
    toolkitMode: ToolkitExportMode = 'bake'
  ): Promise<void> {
    const placedStems = flatStems.map((fs) => ({ stemKey: fs.stemKey, path: fs.stem.path }))
    const wanted = unbussedStemPaths(placedStems, state.busOf)
    const confirmedRoles: Record<string, ArrangeRole> = {}
    if (wanted.length > 0) {
      try {
        const rows = await window.rifffApi.getStemCategoryRoles(wanted)
        for (const [path, row] of Object.entries(rows)) confirmedRoles[path] = row.arrangeRole
      } catch (err) {
        console.error('ProjectMenu: failed to read confirmed stem roles:', err)
      }
    }
    const readiness = assessTidyUpReadiness(placedStems, state.busOf, confirmedRoles)
    if (readiness.needsNudge) {
      setPendingExport({ format, toolkitMode, derivedBusOf: readiness.derivedBusOf })
      setTidyUpNudgeOpen(true)
      return
    }
    void runExportProject(format, toolkitMode, readiness.derivedBusOf)
  }

  // Auto-arrange (and Draw Arrangement, DrawArrangeWizard.tsx) pool every
  // stem from every rifff placed on the timeline (usePlacedFlatStems.ts) --
  // per Elling, only offered for "relatively short arrangements", guarded
  // here at AUTO_ARRANGE_MAX_BARS (shared/autoArrangeApply.ts) bars of real
  // timeline span rather than left to open a wizard that's
  // unusable/misleading on a large project. placedTimelineSpanBars (not
  // loopLengthBars) specifically because loopLengthBars falls back to a
  // 32-bar *default* when nothing is placed at all -- using that here would
  // silently treat an empty timeline as "right at the limit" for the wrong
  // reason. Nothing placed (span 0) is also disabled: there's nothing to
  // arrange, and disabling here beats opening a wizard just to show its own
  // "no rifffs on the timeline yet" empty state.
  const autoArrangeSpanBars = placedTimelineSpanBars(state)
  const autoArrangeDisabledReason =
    autoArrangeSpanBars === 0
      ? 'needs a rifff'
      : autoArrangeSpanBars >= AUTO_ARRANGE_MAX_BARS
        ? `too long (${autoArrangeSpanBars} bars)`
        : undefined

  const buttonStyle = {
    height: 22,
    borderRadius: 0,
    padding: '0 10px',
    fontSize: 10,
    border: '1px solid var(--ra-border)',
    background: 'var(--ra-bg-row-active)',
    color: 'var(--ra-text-2)'
  } as const

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={handleNew} style={buttonStyle}>
        new
      </button>
      <button onClick={onOpenLibrary} style={buttonStyle}>
        open
      </button>
      <button
        ref={saveButtonRef}
        onClick={(e) => {
          // Toggles closed if already open -- see ContextMenu's own
          // ignoreRef doc comment (and the tidy button below) for why the
          // trigger also needs to be passed there.
          if (saveMenu) {
            setSaveMenu(null)
            return
          }
          const rect = e.currentTarget.getBoundingClientRect()
          setSaveMenu({ x: rect.left, y: rect.bottom + 4 })
        }}
        style={buttonStyle}
      >
        save
      </button>
      {saveMenu && (
        <ContextMenu
          x={saveMenu.x}
          y={saveMenu.y}
          ignoreRef={saveButtonRef}
          items={[
            { label: 'save', onClick: handleSave },
            // Named for what each leaves you in (@shared/saveCopyText): the
            // new version switches you to the copy, the file copy doesn't.
            ...(currentSketch !== null && currentSketch.kind === 'library'
              ? [
                  {
                    label: SAVE_AS_NEW_VERSION_LABEL,
                    hint: SAVE_AS_NEW_VERSION_HINT,
                    onClick: handleDuplicateAsNewVersion
                  }
                ]
              : []),
            {
              label: SAVE_COPY_TO_FILE_LABEL,
              hint: SAVE_COPY_TO_FILE_HINT,
              onClick: handleSaveCopyElsewhere
            }
          ]}
          onClose={() => setSaveMenu(null)}
        />
      )}
      <button
        ref={gearButtonRef}
        onClick={(e) => {
          // Toggles closed if already open, rather than always re-opening/
          // repositioning. See ContextMenu's own ignoreRef doc comment for
          // why the trigger also needs to be passed there -- this guard
          // alone isn't enough to stop the menu reopening the instant it's
          // dismissed by ContextMenu's own outside-click handling.
          if (gearMenu) {
            setGearMenu(null)
            return
          }
          const rect = e.currentTarget.getBoundingClientRect()
          setGearMenu({ x: rect.left, y: rect.bottom + 4 })
        }}
        aria-label="more arranger options"
        title="tidy options"
        data-tour-id="tour-tidy"
        style={{
          ...buttonStyle,
          background: state.tidiedView ? 'var(--ra-stretch-on-bg)' : buttonStyle.background,
          border: `1px solid ${state.tidiedView ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: state.tidiedView ? 'var(--ra-stretch-on)' : buttonStyle.color
        }}
      >
        tidy
      </button>
      {gearMenu && (
        <ContextMenu
          x={gearMenu.x}
          y={gearMenu.y}
          ignoreRef={gearButtonRef}
          items={[
            { label: 'tidy up', onClick: onOpenClusterStems },
            { label: 'tidy up library', onClick: onOpenClusterStemsLibrary },
            {
              label: 'auto-arrange',
              onClick: onOpenAutoArrange,
              disabled: autoArrangeDisabledReason !== undefined,
              title: autoArrangeDisabledReason
            },
            {
              label: 'draw arrangement',
              onClick: onOpenDrawArrange,
              disabled: autoArrangeDisabledReason !== undefined,
              title: autoArrangeDisabledReason
            },
            {
              label: state.tidiedView ? 'tidy view: on' : 'tidy view: off',
              onClick: () => dispatch({ type: 'TOGGLE_TIDIED_VIEW' })
            }
          ]}
          onClose={() => setGearMenu(null)}
        />
      )}
      <button
        ref={exportButtonRef}
        onClick={(e) => {
          // Toggles closed if already open -- see the save button above /
          // ContextMenu's own ignoreRef doc comment for why.
          if (exportMenu) {
            setExportMenu(null)
            return
          }
          const rect = e.currentTarget.getBoundingClientRect()
          setExportMenu({ x: rect.left, y: rect.bottom + 4 })
        }}
        disabled={exporting}
        style={{ ...buttonStyle, color: exporting ? 'var(--ra-text-4)' : buttonStyle.color }}
      >
        {exporting ? 'rendering…' : 'export'}
      </button>
      {exportMenu && (
        <ContextMenu
          x={exportMenu.x}
          y={exportMenu.y}
          ignoreRef={exportButtonRef}
          items={[
            { label: 'export mix', onClick: handleExportMix },
            { label: 'export stems', onClick: () => setStemsFormatPickerOpen(true) },
            { label: 'export project…', onClick: () => setExportFormatPickerOpen(true) }
          ]}
          onClose={() => setExportMenu(null)}
        />
      )}
      {exportFormatPickerOpen && (
        <ExportFormatPicker
          // The per-row pans count too, and a pans-only project starts on automation: see
          // exportToolkitChoice.
          toolkitInUse={exportToolkitChoice(state).offer}
          defaultToolkitMode={exportToolkitChoice(state).defaultMode}
          // The session's stems never carry the master stages (the D1/D2 ruling): say so.
          masteringLeftToDaw={dawExportLeavesMastering(state)}
          // Automation mode has no echo bus for the planned throws: warn while it is chosen.
          hasThrows={exportHasThrows(state)}
          onChoose={(format, toolkitMode) => {
            setExportFormatPickerOpen(false)
            void handleExportProject(format, toolkitMode)
          }}
          onCancel={() => setExportFormatPickerOpen(false)}
        />
      )}
      {stemsFormatPickerOpen && (
        <StemsFormatPicker
          onChoose={(format) => {
            setStemsFormatPickerOpen(false)
            void handleExportProject(format)
          }}
          onCancel={() => setStemsFormatPickerOpen(false)}
        />
      )}
      {tidyUpNudgeOpen && (
        <TidyUpNudgeModal
          onTidyUp={() => {
            setTidyUpNudgeOpen(false)
            onOpenClusterStems()
          }}
          onExportAnyway={() => {
            setTidyUpNudgeOpen(false)
            if (pendingExport)
              void runExportProject(
                pendingExport.format,
                pendingExport.toolkitMode,
                pendingExport.derivedBusOf
              )
          }}
        />
      )}
    </div>
  )
}

// How long to wait after the last real edit before writing the crash-
// recovery snapshot — frequent enough that a crash doesn't lose much work,
// infrequent enough not to hammer disk I/O.
const AUTOSAVE_DEBOUNCE_MS = 4000
// ...but never longer than this after the first change not yet autosaved
// (saveSerialization.ts's autosaveDelayMs): a plugin editor reporting edits
// every 750 ms, or non-stop editing, would otherwise restart the debounce
// forever and nothing would ever be autosaved.
const AUTOSAVE_MAX_WAIT_MS = 30_000

const ONBOARDING_SEEN_STORAGE_KEY = 'sssketch:onboardingSeen'
// Separate flag from onboarding's own -- this is a real one-time setup
// decision (where do sketches live), not a recurring reminder, so it
// never shows again once dismissed, unlike the welcome modal.
const LIBRARY_LOCATION_SEEN_STORAGE_KEY = 'sssketch:libraryLocationSeen'
// Tracks whether the guided tour has ever been started -- once true,
// OnboardingModal stops offering "take the tour" on welcome (it's still
// reachable as a deliberate replay from the gear/settings menu, which
// isn't gated on this at all). Same localStorage-flag pattern as
// ONBOARDING_SEEN_STORAGE_KEY above; marked seen the moment the tour
// actually starts (see Frame's own startTour), not on some stricter
// "reached the end" signal -- TourOverlay.tsx has no such signal cheaply
// available, and "started" is an acceptable proxy for "seen" here.
const TOUR_SEEN_STORAGE_KEY = 'sssketch:tourSeen'

/** Sketch mode only: while playing, the Inspector automatically shows
 * whichever rifff currently contains the playhead — no manual click
 * needed to follow along. Scoped to sketch mode specifically because it's
 * the only mode where "the currently playing rifff" is unambiguous
 * (Normal/Compact can have several playing across different rows at
 * once). Only dispatches SELECT when the playing rifff actually
 * CHANGES (a transition into a new one) — not on every ~30Hz position
 * tick — so a manual click on a different tile mid-playback sticks in
 * the Inspector until the next real transition, instead of snapping back
 * within the next tick.
 *
 * Its own component, not inline in Frame — usePos() updates ~30 times a
 * second during playback, and Frame renders the entire timeline (every
 * channel/clip/stem, none of which are memoized). Calling usePos() inside
 * Frame itself subscribed that whole render to every position tick, even
 * in Normal mode where this effect is a no-op — a real, measured cause of
 * sluggish visuals during playback on any project with a nontrivial clip
 * count. Isolating the subscription here means only this invisible
 * component (cheap: no DOM, no children) re-renders on each tick instead. */
function SketchModeAutoFollow({
  onSoundingChange
}: {
  /** The riff Sketch is playing now, or null (sketchSoundingGroupId), reported
   * only when it changes so Frame doesn't re-render on every position tick.
   * The shelf marks that riff's tile. */
  onSoundingChange: (groupId: string | null) => void
}): null {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const pos = usePos()
  const autoFollowedGroupIdRef = useRef<string | null>(null)
  const soundingRef = useRef<string | null>(null)
  useEffect(() => {
    const sounding = sketchSoundingGroupId(state, playing, pos)
    if (sounding !== soundingRef.current) {
      soundingRef.current = sounding
      onSoundingChange(sounding)
    }
  }, [state, playing, pos, onSoundingChange])
  useEffect(() => {
    if (state.mode !== 'sketch' || !playing) {
      autoFollowedGroupIdRef.current = null
      return
    }
    const current = groupIdAtPosition(state, pos)
    if (current && current !== autoFollowedGroupIdRef.current) {
      autoFollowedGroupIdRef.current = current
      dispatch({ type: 'SELECT', groupId: current })
    }
  }, [state, playing, pos, dispatch])
  return null
}

function Frame(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const restoreState = useRestoreState()
  const setBusy = useBusy()
  const projectSessionEpochRef = useRef(crypto.randomUUID())

  // Any key/pointer/wheel input pauses the background scans briefly
  // (backgroundScanGate.ts, 2026-09-21) so their UI-thread analysis never
  // lands mid-typing or mid-click.
  useEffect(() => installBackgroundScanInteractionListeners(), [])

  // A project should always have somewhere to record onto -- fires on
  // mount and again any time recordingChannelIds empties out (e.g.
  // "new project", or loading an old save that predates this feature).
  // Purely additive: doesn't stop a user from adding MORE recording
  // channels via the existing "+ rec" button, just guarantees there's
  // never zero. The Endlesss-style gated recording feature (see the \
  // key handler below) always targets whichever one of these channels
  // comes first in channelOrder.
  //
  // Not with recording off (the advanced features switch, @shared/features):
  // there is nothing to record onto then. Turning it on adds the channel.
  const recordingOn = useFeatureEnabled('recording')
  useEffect(() => {
    if (recordingOn && Object.keys(state.recordingChannelIds).length === 0) {
      dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: crypto.randomUUID() })
    }
  }, [recordingOn, state.recordingChannelIds, dispatch])

  const history = useHistory()
  const playing = usePlaying()
  const {
    enableGatedRecording,
    disableGatedRecording,
    lockInGatedRecording,
    confirmLockInIfRecording,
    handleStop
  } = useGatedRecordingControls()
  const ppb = useZoom()
  // Lets openClipMenu below read the LATEST state at call time (a context
  // menu is a discrete, rare user action, not a hot path) without closing
  // over the reactive `state` variable -- that's what makes it possible to
  // wrap it in useCallback with a stable identity, which is what lets
  // React.memo(ChannelRow) (fed this via Timeline's onOpenClipMenu prop)
  // actually skip re-rendering a channel untouched by a given dispatch.
  // Same pattern as Timeline's own stateRef, see its doc comment for why
  // closing over `state` directly would defeat the point.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const [currentSketch, setCurrentSketch] = useState<CurrentSketch>(null)
  // Remembers the open project's tempo for the next new project's default
  // (lastProjectTempo.ts) -- only once a real project is open, so the
  // pre-project startup state's default tempo never overwrites it.
  useEffect(() => {
    if (currentSketch !== null) saveLastProjectTempo(state.bpm)
  }, [currentSketch, state.bpm])
  // The last content actually known to be durably saved (library folder,
  // external file, or -- immediately after a crash-recovery restore -- the
  // just-recovered snapshot itself). Compared against the live, freshly
  // serialized state in Frame's own handleNew to decide whether there's
  // anything real to lose -- see its own doc comment. Kept as a ref (not
  // state) since nothing needs to re-render off it; it's read once, at
  // click time.
  const lastSavedJsonRef = useRef<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)

  // Moved up from where it used to sit (right before the debounced-autosave
  // effect further down) so both confirmDiscardIfDirty and the dirty
  // indicator below can reuse it instead of paying for a second serialize
  // of potentially-large project state on every render.
  // dirtyCheckJson: never with plugin settings, and neither is any
  // lastSavedJsonRef.current it is compared with (saveSerialization.ts).
  const persistedJson = useMemo(() => dirtyCheckJson(state), [state])

  // Bumped after every explicit save (handleSave) so the dirty-tracking
  // effect below re-evaluates immediately. lastSavedJsonRef stays a plain
  // ref (not state) since most of its writers (initial load, crash-recovery
  // restore, opening a different sketch) already force a re-render of their
  // own (dispatch(LOAD_STATE) and/or setCurrentSketch), which is what the
  // effect below actually keys off. handleSave is the one writer that
  // changes nothing else React-visible, so without this bump the indicator
  // would stay stuck showing "dirty" immediately after a real save.
  const [saveVersion, setSaveVersion] = useState(0)

  // See UnsavedChangesDialog.tsx's own doc comment for why this doesn't
  // need LockInConfirmDialog's reducer-level visibility state -- only Frame
  // (and callbacks it hands down, like ProjectLibraryBrowser's
  // onBeforeReplaceProject below) ever calls confirmDiscardIfDirty.
  const [unsavedChangesPromptOpen, setUnsavedChangesPromptOpen] = useState(false)
  const unsavedChangesResolveRef = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(
    null
  )

  // The single shared "is there real content that would be lost" value --
  // see state/unsavedChanges.ts's own doc comment. Tracked as real React
  // state rather than computed inline from lastSavedJsonRef.current during
  // render: this project's react-hooks/refs lint rule forbids reading a
  // ref's .current synchronously in the render body (see stateRef's own
  // doc comment further down for the same convention already established
  // for the mirrored-state-in-an-effect pattern) -- ref reads are only
  // safe from an effect or an event handler. Recomputed in the effect below
  // whenever anything that could actually change the answer changes: the
  // live content (persistedJson, itself derived from state.rifffs),
  // currentSketch (every lastSavedJsonRef.current writer except handleSave
  // is paired with a setCurrentSketch of its own -- see this effect's
  // dependency array), or saveVersion (handleSave's own signal, since it
  // changes neither state nor currentSketch). The debounced-autosave effect
  // below used to ALSO write straight to the library folder on a timer,
  // which could move lastSavedJsonRef.current without tripping any of these
  // deps and let the indicator lag briefly until something else re-rendered;
  // Task 5 removed that write entirely, closing the gap.
  // A plugin's settings changed since the last save (an editor window
  // opened or used, pluginsTouched.ts) is unsaved too: they are not in
  // persistedJson. Its version also restarts the autosave's debounce below.
  const pluginsTouched = usePluginsTouched()
  const [dirty, setDirty] = useState(false)
  const [shapeDirty, setShapeDirty] = useState(false)
  const [departureSaveBusy, setDepartureSaveBusy] = useState(false)
  const [projectDepartureLocked, setProjectDepartureLocked] = useState(false)
  const departureShapeSnapshotRef = useRef<{
    projectKey: string
    draftId: string | null
    fingerprint: string | null
  } | null>(null)
  useEffect(() => {
    setDirty(
      hasUnsavedChanges(
        state.rifffs,
        persistedJson,
        lastSavedJsonRef.current,
        pluginsTouched.touched
      )
    )
  }, [state.rifffs, persistedJson, currentSketch, saveVersion, pluginsTouched.touched])

  // Bumped by every save, discard and clear of the crash-recovery autosave
  // (recordSaved, clearAutosaveNow): an autosave waits on the engine, and
  // one that started before must not land after and bring back what was
  // just saved or thrown away.
  const autosaveGateRef = useRef(createAutosaveGate())
  // Whether this session has written a crash-recovery file since it (or a
  // save, which clears it in main) last cleared one: the autosave timer
  // clears it once nothing is unsaved, and never touches one it didn't write
  // (a previous session's, still waiting on the recovery prompt).
  const autosaveWrittenRef = useRef(false)
  // When the first change not yet autosaved happened (null: none), for the
  // autosave's max wait (AUTOSAVE_MAX_WAIT_MS).
  const autosaveUnsavedSinceRef = useRef<number | null>(null)
  // This session is done with the recovery file (a save, a discard of its
  // unsaved work, a welcome button). Main deletes it, or moves it aside when
  // it is a previous session's snapshot still awaiting Recover or Discard
  // (projectFile.ts's clearAutosave), so it is offered again next launch.
  function clearAutosaveNow(): void {
    autosaveGateRef.current.bump()
    autosaveWrittenRef.current = false
    void window.rifffApi.clearAutosave()
  }
  // The user decided on the offered snapshot (Recover or Discard), or it held
  // nothing worth offering: deleted for good.
  async function discardRecoveryNow(): Promise<void> {
    autosaveGateRef.current.bump()
    autosaveWrittenRef.current = false
    await window.rifffApi.discardAutosave()
  }

  /** `saved` is now durably on disk as the open project: the unsaved-changes
   * baseline, the plugins-touched flag (unless touched since
   * `pluginsTouchedVersion`, the save's start) and the autosave gate. */
  function recordSaved(saved: AppState, pluginsTouchedVersion: number): void {
    lastSavedJsonRef.current = dirtyCheckJson(saved)
    clearPluginsTouched(pluginsTouchedVersion)
    autosaveGateRef.current.bump()
    // Every save path clears the recovery file in main (projectFile.ts).
    autosaveWrittenRef.current = false
    // A save moves a still-offered previous snapshot aside in main, replacing
    // the kept older one: neither is on disk as offered any more. Both stay
    // for the next launch's offer.
    setRecoverableAutosave(null)
    setRecoverablePrevious(null)
    setSaveVersion((v) => v + 1)
  }

  async function handleRename(newName: string): Promise<void> {
    setRenameError(null)
    if (currentSketch === null) {
      try {
        const touchedVersion = pluginsTouchedSnapshot().version
        await window.rifffApi.saveProjectToLibrary(newName, await serializeForSave())
        setCurrentSketch({ kind: 'library', name: newName })
        recordSaved(state, touchedVersion)
      } catch (err) {
        console.error('Frame: failed to save project under new name:', err)
        setRenameError(err instanceof Error ? err.message : String(err))
      }
      return
    }
    if (currentSketch.kind === 'library') {
      const result = await window.rifffApi.renameSketch(currentSketch.name, newName)
      if (!result.ok) {
        setRenameError(result.reason)
        return
      }
      setCurrentSketch({ kind: 'library', name: newName })
      return
    }
    const result = await window.rifffApi.renameExternalSketchFile(currentSketch.path, newName)
    if (!result.ok) {
      setRenameError(result.reason)
      return
    }
    setCurrentSketch({ kind: 'external', path: result.path })
  }

  /** The JSON every save path writes -- save, save a copy, duplicate,
   * rename, the crash-recovery autosave (saveSerialization.ts): per slot,
   * the engine's live plugin settings where it holds this project's plugin
   * (@shared/pluginSwitch's slotsEngineHolds, before AND after the round
   * trip, the project unchanged meanwhile), else the saved settings not yet
   * handed over, else the latest capture -- so no save drops what the
   * project read, and none takes another project's plugin for this one's.
   * The engine is not asked at all when it holds none of them (plugins off,
   * none in the project, none loaded yet). A user's save refuses to write
   * when the engine holds them and doesn't answer (it would quietly fall
   * back to older settings); the autosave, best effort, takes `bestEffort`.
   * A successful capture is kept as the fallback (an engine restart reloads
   * from it). */
  async function serializeForSave(
    options?: { bestEffort?: boolean },
    stateToSave: AppState = stateRef.current
  ): Promise<string> {
    const chains = {
      masterChain: stateToSave.masterChain,
      channelPlugins: stateToSave.channelPlugins
    }
    const generation = pendingPluginStatesGeneration()
    const pending = pendingPluginStatesRef.current
    const fallback = pluginCaptureFallback()
    const heldBefore = slotsEngineHolds(pluginSwitchStateRef.current, chains, generation)
    let live: PluginStatesMap = {}
    if (heldBefore.size > 0) {
      const raw = await window.rifffApi.engineGetPluginStates()
      const heldAfter = slotsEngineHolds(
        pluginSwitchStateRef.current,
        chains,
        pendingPluginStatesGeneration() === generation ? generation : -1
      )
      const held = new Set([...heldBefore].filter((slotKey) => heldAfter.has(slotKey)))
      // No answer while the engine still holds them: refuse. (An engine that
      // restarted meanwhile holds none of them: the saved settings and the
      // fallback are all there is.)
      if (raw === null && held.size > 0 && !options?.bestEffort) {
        throw new Error('failed to read current plugin state from the engine')
      }
      live = liveSettingsForSave(raw, chains, held)
      recordPluginCapture(live, generation)
    }
    return projectJsonForSave(stateToSave, live, pending, fallback)
  }

  /** Writes the live project (or `stateToSave`, the exact state a departure
   * save publishes an EEEDIT draft into first) and says how it went, without
   * telling the user anything itself (saveOutcomeNotice decides that): the quit
   * prompt's save has to answer main before an alert can block the renderer. */
  async function saveProjectNow(stateToSave: AppState = stateRef.current): Promise<SaveOutcome> {
    try {
      const touchedVersion = pluginsTouchedSnapshot().version
      const savedDirtyJson = dirtyCheckJson(stateToSave)
      const json = await serializeForSave(undefined, stateToSave)
      if (currentSketch === null) {
        const name = await window.rifffApi.generateDefaultProjectName()
        await window.rifffApi.saveProjectToLibrary(name, json)
        setCurrentSketch({ kind: 'library', name })
      } else if (currentSketch.kind === 'library') {
        await window.rifffApi.saveProjectToLibrary(currentSketch.name, json)
      } else {
        await window.rifffApi.saveProjectInPlace(currentSketch.path, json)
      }
      recordSaved(stateToSave, touchedVersion)
      return saveCompletionIsCurrent(
        savedDirtyJson,
        dirtyCheckJson(stateRef.current),
        touchedVersion,
        pluginsTouchedSnapshot().version
      )
        ? { kind: 'saved' }
        : { kind: 'changed' }
    } catch (err) {
      console.error('Frame: failed to save project:', err)
      return { kind: 'failed', error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** The Save menu item and Cmd+S: true when the write landed. Newer edits made
   * while it was in flight just leave the project marked unsaved. With EEEDIT
   * open, it saves as a departure save does: an unpublished draft is added to
   * the shelf first, so the saved project holds it (EEEDIT's own Cmd+S adds to
   * the shelf without saving). */
  async function handleSave(): Promise<boolean> {
    const outcome = shapeDraftRef.current
      ? await saveProjectBeforeLeavingNow()
      : await saveProjectNow()
    const notice = saveOutcomeNotice(outcome, 'save')
    if (notice) window.alert(notice)
    return outcome.kind !== 'failed' && outcome.kind !== 'busy'
  }

  /** Saving before something that closes or replaces the live project
   * (quit's Save, and Save in the discard guard before New or opening
   * another). True only when the save holds the newest edits; on false the
   * caller must not go on, and the user has already been told why. */
  async function saveBeforeLeaving(): Promise<boolean> {
    const outcome = await saveProjectBeforeLeavingNow()
    const notice = saveOutcomeNotice(outcome, 'leaving')
    if (notice) window.alert(notice)
    return outcome.kind === 'saved'
  }

  /** Shared discard-guard -- called from every place about to replace the
   * live in-memory project (New, opening/restoring a different library
   * sketch, opening from disk). Resolves 'discard' immediately when there's
   * nothing real to lose; otherwise shows UnsavedChangesDialog and resolves
   * once the user picks a button. See
   * docs/superpowers/specs/2026-08-14-explicit-save-model-design.md,
   * section 4. */
  function confirmDiscardIfDirty(): Promise<'save' | 'discard' | 'cancel'> {
    if (!dirty && !shapeDirty) return Promise.resolve('discard')
    return new Promise((resolve) => {
      unsavedChangesResolveRef.current = resolve
      setUnsavedChangesPromptOpen(true)
    })
  }

  function resolveUnsavedChangesPrompt(choice: 'save' | 'discard' | 'cancel'): void {
    setUnsavedChangesPromptOpen(false)
    unsavedChangesResolveRef.current?.(choice)
    unsavedChangesResolveRef.current = null
  }

  const [newProjectModal, setNewProjectModal] = useState<{ defaultName: string } | null>(null)

  async function handleNew(): Promise<void> {
    beginProjectDeparture()
    const choice = await confirmDiscardIfDirty()
    if (choice === 'cancel') {
      endProjectDeparture()
      return
    }
    if (choice === 'save') {
      const saved = await saveBeforeLeaving()
      // Save failed (saveBeforeLeaving already alerted) -- the live project is
      // still safely in the editor and unsaved, so bail out here rather
      // than opening the new-project modal, which would discard it.
      if (!saved) {
        endProjectDeparture()
        return
      }
    } else {
      // 'discard' -- the user just explicitly threw away unsaved work.
      // The debounced autosave effect may still have a stale crash-recovery
      // snapshot of exactly that content on disk; clear it so a later
      // launch doesn't turn around and offer to "recover" what was just
      // discarded.
      clearAutosaveNow()
    }
    let defaultName: string
    try {
      defaultName = await window.rifffApi.generateDefaultProjectName()
    } catch (error) {
      console.error('App: failed to prepare a new project:', error)
      endProjectDeparture()
      return
    }
    if (!projectDepartureIsCurrent()) {
      endProjectDeparture()
      return
    }
    setNewProjectModal({ defaultName })
  }

  function commitNewProject(name: string, bpm: number): void {
    void (async () => {
      // NewProjectModal's own tempo field (direct request, 2026-09-20) --
      // freshState (not bare `initialState`) is used for BOTH the dispatch
      // AND the dirty-tracking baseline below, so picking a tempo up front
      // doesn't immediately read as an unsaved change the instant the
      // project is created. The same goes for the sound settings: a new
      // project starts from the app-wide defaults (native radio sound plan,
      // Task 2; fetched once, at mount, below), and that is not an edit.
      try {
        const sound = await appSoundDefaults()
        if (!projectDepartureIsCurrent()) return
        // Its own seed, so its timeline throws are its own (@shared/timelineThrows).
        const freshState = { ...initialState, bpm, sound, projectSeed: newProjectSeed() }
        invalidateShapeSession()
        projectSessionEpochRef.current = crypto.randomUUID()
        dispatch({ type: 'LOAD_STATE', state: freshState })
        // The previous project's saved plugin settings are not this one's, nor its missing copies.
        replacePendingPluginStates({})
        setReonedMissing([])
        lastSavedJsonRef.current = dirtyCheckJson(freshState)
        setCurrentSketch({ kind: 'library', name })
        setNewProjectModal(null)
      } catch (error) {
        console.error('App: failed to create a new project:', error)
      } finally {
        endProjectDeparture()
      }
    })()
  }
  // Guards the startup effect below against StrictMode's dev-only
  // double-invoke: without this, both invocations independently call
  // loadAutosave() before either gets to clearAutosave()/setRecoverableAutosave(),
  // double-counting the same on-disk snapshot -- confirmed live pre-redesign
  // (see git history: this used to manifest as two "recover unsaved work?"
  // prompts in a row for the same content).
  const startupResolvedRef = useRef(false)

  // Non-null only when there's a genuine, unresolved crash-recovery
  // snapshot from a previous session -- one that was never explicitly
  // saved OR discarded (every explicit discard path -- New, library open/
  // restore, open-from-disk, quit's "Don't Save" -- now calls
  // clearAutosave() itself, so surviving to the next launch means a real
  // crash/force-quit/power-loss, not a normal exit). OnboardingModal reads
  // this (via hasRecovery) to show its recovery sub-view instead of the
  // normal new/open welcome -- see its own doc comment for why the view is
  // derived from this prop rather than mirrored into local state there.
  const [recoverableAutosave, setRecoverableAutosave] = useState<{ json: string } | null>(null)
  // The one kept older snapshot (projectFile.ts's loadPreviousAutosave): a
  // past session's offer that was left undecided and moved aside when that
  // session needed the recovery file. Offered next to the current one.
  const [recoverablePrevious, setRecoverablePrevious] = useState<{
    json: string
    sketchJson: string | null
  } | null>(null)
  // The welcome's x (hideOnboardingForSession, below): closed for this session
  // without recovering or discarding. Declared here because the autosave
  // effect below keys off it (autosaveWaitsOnRecoveryOffer).
  const [onboardingDismissedForSession, setOnboardingDismissedForSession] = useState(false)

  // Once, on mount: check for a crash-recovery snapshot and, if real,
  // surface it via recoverableAutosave for OnboardingModal to offer --
  // never auto-loads it, and never shows a native window.confirm (folded
  // into the welcome modal itself, see its own recovery sub-view). If
  // there's nothing to recover, this deliberately does nothing else --
  // no auto-reopening the last project, no auto-naming a fresh sketch.
  // OnboardingModal's default (non-recovery) sub-view already renders in
  // that case via the existing showOnboarding state, and its own "new
  // project" / "open project" buttons are what start a real session now.
  useEffect(() => {
    if (startupResolvedRef.current) return
    startupResolvedRef.current = true
    // Fetch the app-wide sound settings now, so a new or opened project
    // never waits on them, and let the startup state adopt them -- only
    // while its sound is still the untouched startup one (store.ts's
    // ADOPT_APP_SOUND_DEFAULTS), and as a baseline, not an undoable edit,
    // the same way commitNewProject's are.
    void appSoundDefaults().then((sound) =>
      dispatch({ type: 'ADOPT_APP_SOUND_DEFAULTS', sound, ifStill: startupState.sound! })
    )
    void (async () => {
      const json = await window.rifffApi.loadAutosave()
      // "unsaved work" means real content, not just any autosave file --
      // a totally untouched launch still ends up with one 4s after mount
      // (the mount effect above unconditionally adds a recording channel
      // when state.recordingChannelIds is empty, which it always is on
      // initialState, and that alone is enough to make serializeProject
      // differ from blank). Without this check, a tester who launches,
      // waits a few seconds, and quits normally gets asked to "recover"
      // on their very next launch for content that was never really
      // there. Matches the same Object.keys(...).length > 0 definition
      // of "real" already used by the New-project dirty check above.
      if (json !== null && recoverySnapshotHasContent(json)) {
        setRecoverableAutosave({ json })
      } else if (json) {
        // Autosave file exists but has no real content (see above) -- delete
        // it so it doesn't linger and get offered on some later launch once
        // it might coincidentally look more "real."
        await discardRecoveryNow()
      }
      const previous = await window.rifffApi.loadPreviousAutosave()
      if (previous !== null && recoverySnapshotHasContent(previous.json))
        setRecoverablePrevious(previous)
      else if (previous !== null) void window.rifffApi.discardPreviousAutosave()
    })()
  }, [dispatch])

  /** OnboardingModal's "recover" button -- loads the just-found snapshot
   * into the live project, restores currentSketch from its sidecar (see
   * writeAutosaveSketchInfo/loadAutosaveSketchInfo -- without this, the
   * next routine Save after a recovered library sketch would silently
   * fork a brand-new library entry instead of writing back to the sketch
   * the recovered content actually came from), deletes the snapshot, and
   * closes the welcome modal. A kept older snapshot stays on disk, offered
   * again next launch. */
  async function handleRecoverAutosave(dontShowAgain: boolean): Promise<void> {
    if (!recoverableAutosave) return
    await loadRecoveredSnapshot(
      recoverableAutosave.json,
      await window.rifffApi.loadAutosaveSketch()
    )
    await discardRecoveryNow()
    setRecoverableAutosave(null)
    closeWelcome(dontShowAgain)
  }

  /** "recover older": the same for the kept older snapshot. The current
   * snapshot, if one is still offered, is left undecided: the welcome's
   * other buttons' rule applies (dismissOnboarding), so main moves it aside
   * into the slot this just emptied. */
  async function handleRecoverPrevious(dontShowAgain: boolean): Promise<void> {
    if (!recoverablePrevious) return
    await loadRecoveredSnapshot(recoverablePrevious.json, recoverablePrevious.sketchJson)
    await window.rifffApi.discardPreviousAutosave()
    setRecoverablePrevious(null)
    dismissOnboarding(dontShowAgain)
  }

  async function loadRecoveredSnapshot(json: string, sketchJson: string | null): Promise<void> {
    const { state: loaded, pluginStates } = deserializeProject(
      JSON.parse(json),
      await appSoundDefaults()
    )
    // Same pre-warm-before-LOAD_STATE reasoning as the library browser's
    // onSelect/onOpenFromDisk handlers below -- avoids the timeline/sketch
    // strip rendering with blank waveforms that pop in one at a time as
    // each mounted component's own decode finishes.
    setBusy('loading…')
    // Missing re-oned copies are rebuilt before the engine sees the project; the baseline is the
    // snapshot as saved, so only a copy that moved shows as unsaved (reonedRepairOnOpen.ts).
    const opened = await openWithReonedRepair(loaded)
    try {
      await warmStemCaches(opened.state)
      invalidateShapeSession()
      projectSessionEpochRef.current = crypto.randomUUID()
      restoreState(opened.state, pluginStates)
    } catch (err) {
      reonedOpenFailed()
      throw err
    }
    lastSavedJsonRef.current = opened.savedJson
    setBusy(null)
    // The sketch-info sidecar can be missing/corrupted even when the
    // content autosave above recovered fine (they're written/read
    // independently). Falling back to null here would leave real
    // recovered content showing as "untitled." Give it a real name
    // instead, same as the fresh-start path below.
    setCurrentSketch(
      sketchJson
        ? (JSON.parse(sketchJson) as CurrentSketch)
        : { kind: 'library', name: await window.rifffApi.generateDefaultProjectName() }
    )
  }

  /** OnboardingModal's "discard" button -- clears the snapshot, which is
   * all it takes to make the recovery notice disappear from the modal on
   * the next render (see OnboardingModal's own doc comment: the notice sits
   * ON TOP OF the normal new/open welcome now, not as a separate sub-view,
   * so there's nothing left to "fall through" to here). No need to force
   * showOnboarding open the way this used to -- the new/open buttons were
   * already visible underneath the notice the whole time, so discarding
   * just respects whatever showOnboarding already was (including a past
   * "don't show this again," now that there's no longer a risk of
   * stranding the user on a bare recovery screen with no other buttons). */
  function handleDiscardRecovery(): void {
    void discardRecoveryNow()
    setRecoverableAutosave(null)
  }

  function handleDiscardPreviousRecovery(): void {
    void window.rifffApi.discardPreviousAutosave()
    setRecoverablePrevious(null)
  }

  // Debounced crash-recovery autosave — fires AUTOSAVE_DEBOUNCE_MS after the
  // last real edit. Depends on the SERIALIZED content (a string), not state
  // itself, so a purely transient UI change (the arranger mode, say --
  // excluded from serializeProject's own output) produces the exact
  // same string and doesn't reset the debounce timer for nothing. Also
  // writes currentSketch to its own sidecar file in lockstep (see
  // writeAutosaveSketchInfo), so a crash-recovery restore knows which
  // sketch the recovered snapshot actually belongs to.
  //
  // Used to ALSO write straight to the library folder (saveProjectToLibrary)
  // once a real named sketch had real content -- removed as of the explicit
  // save model (see docs/superpowers/specs/2026-08-14-explicit-save-model-
  // design.md, section 1): the real project file on disk should only change
  // on an explicit save (the Save button, Cmd+S, or the quit-time prompt),
  // never on a timer. This effect's only remaining job is the
  // crash-recovery snapshot, always a separate, decoupled mechanism (see
  // projectFile.ts's writeAutosave/loadAutosave/clearAutosave) that needed
  // no change here.
  //
  // Skipped entirely while recoverableAutosave is non-null -- that means a
  // genuine crash-recovery snapshot is on disk and OnboardingModal is
  // showing its recovery sub-view, still waiting on the user's Recover/
  // Discard decision. Before this guard, leaving that prompt open for
  // AUTOSAVE_DEBOUNCE_MS or longer let this effect fire and overwrite the
  // real snapshot with persistedJson -- at that point still just
  // serializeProject(initialState), since the live state hasn't been
  // touched yet -- destroying the exact safety net crash recovery exists
  // to provide. Resumes normally as soon as recoverableAutosave flips back
  // to null (Recover or Discard, both in handleRecoverAutosave/
  // handleDiscardRecovery above), or the welcome is closed with its x
  // (autosaveWaitsOnRecoveryOffer): the snapshot then stays until this
  // session has unsaved work, whose first write moves it aside in main as
  // the kept older snapshot (projectFile.ts), offered again next launch.
  // Waiting for the rest of the session left that work with no crash
  // protection.
  //
  // Also restarted by a plugin being touched (pluginsTouched.version: a knob
  // turned in an open editor), so a plugin-only change is autosaved too --
  // with a max wait (AUTOSAVE_MAX_WAIT_MS), since a plugin can report edits
  // non-stop. Writes only while something is unsaved: just after a save, an
  // open or a first save (currentSketch changing), there is nothing to
  // recover, and once edits are undone back to the saved state the file this
  // session wrote is cleared (autosaveAction). Gated (autosaveGateRef): one
  // that started before a save, a discard or a clear is dropped when its
  // engine round trip comes back. Each tick first asks the engine for a plugin
  // edit it had not reported (an IR loaded in an open editor, main's
  // checkPluginEdits): one marks the plugins touched, which restarts this
  // effect, and its next tick writes.
  useEffect(() => {
    if (
      autosaveWaitsOnRecoveryOffer({
        recoveryPending: recoverableAutosave !== null,
        offerDismissed: onboardingDismissedForSession
      })
    )
      return
    const now = Date.now()
    autosaveUnsavedSinceRef.current ??= now
    const delay = autosaveDelayMs(
      now,
      autosaveUnsavedSinceRef.current,
      AUTOSAVE_DEBOUNCE_MS,
      AUTOSAVE_MAX_WAIT_MS
    )
    let cancelled = false
    const id = window.setTimeout(async () => {
      autosaveUnsavedSinceRef.current = null
      const pluginEdited = await window.rifffApi.engineCheckPluginEdits().catch(() => false)
      if (pluginEdited) {
        markPluginsTouched()
        return
      }
      if (cancelled) return
      const unsaved = hasUnsavedChanges(
        state.rifffs,
        persistedJson,
        lastSavedJsonRef.current,
        pluginsTouchedSnapshot().touched
      )
      const action = autosaveAction(unsaved, autosaveWrittenRef.current)
      if (action === 'clear') clearAutosaveNow()
      if (action !== 'write') return
      const token = autosaveGateRef.current.begin()
      const sketchJson = JSON.stringify(currentSketch)
      // With plugin settings (persistedJson has none), so a crash recovery
      // keeps them; best effort if the engine doesn't answer.
      void serializeForSave({ bestEffort: true })
        .then(async (json) => {
          if (!autosaveGateRef.current.isCurrent(token)) return
          autosaveWrittenRef.current = true
          await window.rifffApi.autosaveProject(json)
          await window.rifffApi.autosaveProjectSketch(sketchJson)
          // A previous session's snapshot, left by the welcome's x, is now
          // moved aside in main, replacing the kept older one: what is left on
          // disk is this session's, so offering either again here would
          // recover or delete the wrong file. The next launch offers it.
          if (recoverableAutosave !== null) {
            setRecoverableAutosave(null)
            setRecoverablePrevious(null)
          }
        })
        .catch((err) => console.error('Frame: crash-recovery autosave failed:', err))
    }, delay)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serializeForSave is a fresh closure every render over this render's `state`, the one persistedJson was made from; keyed on persistedJson (not state) so a transient UI change doesn't restart the debounce (see above)
  }, [
    persistedJson,
    currentSketch,
    recoverableAutosave,
    onboardingDismissedForSession,
    pluginsTouched.version
  ])
  const [pickerGroupId, setPickerGroupId] = useState<string | null>(null)
  const [riffLibraryOpen, setRiffLibraryOpen] = useState(false)
  // Direct request, 2026-09-17: "i've had to close discover occasionally
  // and would like to return to working on the group of stems i had
  // before, could these be saved temporarily?" -- session-only (resets on
  // quit, not persisted into the project file -- confirmed with Elling).
  // Lives here, not inside LibraryBrowser (which used to own these
  // locally), specifically so it survives the WHOLE LibraryBrowser modal
  // unmounting when closed, not just a 'browse' <-> 'discover' tab switch
  // within one already-open session -- App.tsx itself never unmounts for
  // the life of the app, LibraryBrowser does every time the modal closes.
  const [discoverSlots, setDiscoverSlots] = useState<DiscoverSlot[]>([])
  // Cross is deliberately disposable: its result only persists when the
  // user explicitly adds it to Shelf or Timeline. Closing Cross clears this
  // draft, so opening another pair never needs a discard confirmation.
  const [crossDraft, setCrossDraft] = useState<CrossDraft | null>(null)
  const [crossOpen, setCrossOpen] = useState(false)
  // Shape is also a disposable working copy. Only Add to Shelf publishes a
  // new riff; closing leaves the source and the shared riff selection intact.
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null)
  const [shapeProcessRacks, setShapeProcessRacks] = useState<
    Record<string, ShapeProcessRackUnit[]>
  >({})
  const [shapeOpen, setShapeOpen] = useState(false)
  const [shapeDiscardPromptOpen, setShapeDiscardPromptOpen] = useState(false)
  const shapeDraftRef = useRef<ShapeDraft | null>(null)
  const shapeOpenRef = useRef(false)
  const shapeProjectKeyRef = useRef('')
  shapeDraftRef.current = shapeDraft
  shapeOpenRef.current = shapeOpen
  shapeProjectKeyRef.current = shapeProjectKey(projectSessionEpochRef.current)
  const shapePreviewStopRef = useRef<(() => void) | null>(null)
  const shapeOpenGenerationRef = useRef(0)
  const shapeSavedFingerprintRef = useRef('')
  const shapePublishedRiffIdRef = useRef<string | null>(null)
  const shapeDepartureSaveRef = useRef(false)
  const shapeOpeningSelectionRef = useRef<{
    ids: Set<string>
    anchorId: string | null
  } | null>(null)
  function invalidateShapeSession(): void {
    shapeOpenGenerationRef.current += 1
    shapePreviewStopRef.current?.()
    shapePreviewStopRef.current = null
    shapeOpeningSelectionRef.current = null
    shapePublishedRiffIdRef.current = null
    shapeSavedFingerprintRef.current = ''
    setShapeDirty(false)
    setShapeDiscardPromptOpen(false)
    setShapeOpen(false)
    setShapeDraft(null)
  }
  function beginProjectDeparture(): void {
    const current = shapeDraftRef.current
    departureShapeSnapshotRef.current = {
      projectKey: shapeProjectKeyRef.current,
      draftId: current?.id ?? null,
      fingerprint: current ? shapeContentFingerprint(current) : null
    }
    setProjectDepartureLocked(true)
  }
  function projectDepartureIsCurrent(): boolean {
    const expected = departureShapeSnapshotRef.current
    if (!expected) return false
    const current = shapeDraftRef.current
    return (
      shapeProjectKeyRef.current === expected.projectKey &&
      (current?.id ?? null) === expected.draftId &&
      (current ? shapeContentFingerprint(current) : null) === expected.fingerprint
    )
  }
  function endProjectDeparture(): void {
    departureShapeSnapshotRef.current = null
    setProjectDepartureLocked(false)
  }
  // The re-oned copies cleanup counts what Cross and Discover hold as in use (reonedInUse.ts).
  // The saved preview level, before the first preview plays (audio/previewOutput.ts).
  useEffect(() => loadSavedPreviewLevel(), [])
  useEffect(() => setReonedSessionRoot('cross', crossDraft), [crossDraft])
  useEffect(() => setReonedSessionRoot('discover', discoverSlots), [discoverSlots])
  useEffect(() => setReonedSessionRoot('shape', shapeDraft), [shapeDraft])
  // One shared, session-only riff selection for both Sketch and Shelf.
  // Keeping this above the fullscreen Cross/Discover workspaces means the
  // exact working set remains highlighted when either workspace closes;
  // keeping it outside project serialization means it is still ordinary UI
  // state, not musical project data. The anchor is separate from state.sel:
  // Sketch's playback auto-follow legitimately changes state.sel as the
  // playhead advances, but must not collapse a deliberate two-riff choice.
  // The riff Sketch is playing right now (SketchModeAutoFollow), for the
  // shelf's playhead-coloured edge on its tile.
  const [sketchSoundingId, setSketchSoundingId] = useState<string | null>(null)
  const [riffSelection, setRiffSelection] = useState<{
    ids: Set<string>
    anchorId: string | null
  }>(() => ({ ids: new Set(), anchorId: null }))
  // Hover correspondence is intentionally independent of the working
  // selection above. It is a momentary visual answer to "where else is
  // this same riff?" and must never collapse a two-riff Cross selection.
  const [hoveredRiffKey, setHoveredRiffKey] = useState<string | null>(null)
  const selectedRiffIds = useMemo(() => {
    const valid = new Set([...riffSelection.ids].filter((id) => state.rifffs[id] !== undefined))
    // A loaded project already has an Inspector selection. Until the user
    // deliberately establishes a shared working set, mirror that one riff
    // instead of making Shelf/Sketch look unselected after open/recovery.
    if (valid.size === 0 && state.sel && state.rifffs[state.sel]) valid.add(state.sel)
    return valid
  }, [riffSelection.ids, state.rifffs, state.sel])
  const riffSelectionAnchorId =
    riffSelection.anchorId && state.rifffs[riffSelection.anchorId]
      ? riffSelection.anchorId
      : selectedRiffIds.size === 1
        ? [...selectedRiffIds][0]
        : null
  const handleRiffSelectionChange = useCallback(
    (groupIds: Set<string>, anchorId: string | null) => {
      setRiffSelection({ ids: new Set(groupIds), anchorId })
    },
    []
  )
  const selectPublishedShelfRiff = useCallback(
    (groupId: string) => {
      setRiffSelection({ ids: new Set([groupId]), anchorId: groupId })
      dispatch({ type: 'SELECT', groupId })
    },
    [dispatch]
  )
  const inspectorCrossPair = useMemo<[Rifff, Rifff] | null>(() => {
    if (selectedRiffIds.size !== 2) return null
    const [leftId, rightId] = [...selectedRiffIds]
    const left = state.rifffs[leftId]
    const right = state.rifffs[rightId]
    return left && right ? [left, right] : null
  }, [selectedRiffIds, state.rifffs])
  const inspectorEditRifff = useMemo<Rifff | null>(() => {
    // The Inspector already has one concrete riff (`state.sel`). Use that as
    // Edit's source instead of making the button depend on the separate
    // shared-selection bookkeeping. The latter can briefly lag the visible
    // Sketch selection (especially after leaving another full-screen mode),
    // which made Edit disappear even though the Inspector showed a riff.
    // Exactly two selected riffs still belong to Cross, so keep Edit out of
    // that deliberately multi-riff state.
    if (inspectorCrossPair) return null
    return state.sel ? (state.rifffs[state.sel] ?? null) : null
  }, [inspectorCrossPair, state.rifffs, state.sel])
  useEffect(() => {
    if (!shapeDraft) return
    if (shapeDraft.projectKey === shapeProjectKey(projectSessionEpochRef.current)) return
    shapeOpenGenerationRef.current += 1
    shapePreviewStopRef.current?.()
    shapePreviewStopRef.current = null
    shapeOpeningSelectionRef.current = null
    setShapeDiscardPromptOpen(false)
    setShapeOpen(false)
    setShapeDraft(null)
  }, [currentSketch, shapeDraft, state.projectSeed])
  useEffect(() => {
    setShapeDirty(
      shapeDraft !== null &&
        shapeContentFingerprint(shapeDraft) !== shapeSavedFingerprintRef.current
    )
  }, [shapeDraft])
  // Discover artist mode: the chosen artists (combine artists, spec
  // 2026-10-06), `[null]` = me. Session-only, the same lifetime as
  // discoverSlots -- Discover opens on `me` at launch.
  const [discoverArtists, setDiscoverArtists] = useState<ArtistSelection>(ME_SELECTION)
  // What the guided flow sees of Discover. Published by DiscoverPanel (the
  // only component that knows whether a slot has really resolved) and kept
  // here rather than inside the bubble so it survives the library modal
  // closing -- locking the climax from a step whose panel is not currently
  // mounted still locks the loop the user actually built. Stale by the same
  // amount the library has been shut for, which is exactly nothing, because
  // nothing can change Discover while it is not on screen.
  const [coachSlots, setCoachSlots] = useState<CoachSlotSnapshot[]>([])
  const handleCoachSlotsChange = useCallback((next: CoachSlotSnapshot[]) => {
    setCoachSlots(next)
  }, [])
  // 0 = strictest (the Discover "matching" dial all the way up). Starts at
  // DEFAULT_DISCOVER_CHAOS, matching about 25 (Elling, 2026-10-01; was 0,
  // 2026-09-22).
  const [discoverChaos, setDiscoverChaos] = useState(DEFAULT_DISCOVER_CHAOS)
  const [discoverUndoStack, setDiscoverUndoStack] = useState<DiscoverSlot[][]>([])
  const [discoverRedoStack, setDiscoverRedoStack] = useState<DiscoverSlot[][]>([])
  // An undo or redo in Discover can bring back a slot seeded from a copy (reonedInUse.ts).
  useEffect(
    () => setReonedSessionRoot('discover-history', [discoverUndoStack, discoverRedoStack]),
    [discoverUndoStack, discoverRedoStack]
  )
  const [discoverSeedBpm, setDiscoverSeedBpm] = useState<number | null>(null)
  // The open Discover seed's rotation, per jam: a candidate from the seed's own jam is baked by
  // it (discoverCandidateStem.ts), so it plays in phase with the seed. Set with the seed, like
  // discoverSeedBpm; null for a seed at its raw phase.
  const [discoverSeedPhase, setDiscoverSeedPhase] = useState<DiscoverSeedPhase | null>(null)
  // What Discover resolves with: the seed's phase only while a seed row is there
  // (activeSeedPhase), so it lapses with the seed rows and comes back with them on undo.
  const activeDiscoverSeedPhase = useMemo(
    () => activeSeedPhase(discoverSeedPhase, discoverSlots),
    [discoverSeedPhase, discoverSlots]
  )
  // First-launch-only "where do sketches save?" step -- shown BEFORE the
  // welcome modal (suppresses it below while this is up), since knowing
  // where your work lives is more foundational than a feature tour. Never
  // reappears once dismissed, unlike the welcome modal.
  const [showLibraryLocationSetup, setShowLibraryLocationSetup] = useState(() => {
    try {
      return localStorage.getItem(LIBRARY_LOCATION_SEEN_STORAGE_KEY) === null
    } catch {
      return false
    }
  })
  const [libraryRootForSetup, setLibraryRootForSetup] = useState<string | null>(null)
  useEffect(() => {
    if (!showLibraryLocationSetup) return
    window.rifffApi
      .getLibraryRoot()
      .then(setLibraryRootForSetup)
      .catch((err) => {
        console.error('Frame: getLibraryRoot() failed:', err)
      })
  }, [showLibraryLocationSetup])
  function dismissLibraryLocationSetup(): void {
    setShowLibraryLocationSetup(false)
    try {
      localStorage.setItem(LIBRARY_LOCATION_SEEN_STORAGE_KEY, '1')
    } catch {
      // localStorage unavailable -- just means this shows again next
      // launch too, not worth surfacing as an error.
    }
  }
  async function handleChooseLibraryFolderAtSetup(): Promise<void> {
    const picked = await window.rifffApi.pickFolder()
    if (!picked) return
    await window.rifffApi.setLibraryRoot(picked)
    setLibraryRootForSetup(picked)
  }

  // Shown on every launch by default (per machine, matching loreUsername's
  // own localStorage-persisted convention in LibraryBrowser.tsx) --
  // only stops once "don't show this again" is checked. Read lazily in
  // useState's initializer, not an effect, so it can't flash open-then-
  // closed on the very first render.
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_SEEN_STORAGE_KEY) !== '1'
    } catch {
      // localStorage unavailable (e.g. private mode) -- an opt-out could
      // never be persisted either, so keep showing rather than silently
      // hiding it forever.
      return true
    }
  })
  function hideOnboardingForSession(): void {
    setShowOnboarding(false)
    setOnboardingDismissedForSession(true)
  }

  function dismissOnboarding(dontShowAgain: boolean): void {
    // Choosing any of this modal's normal actions (new/open/login/tour)
    // while a recovery notice is still showing (see OnboardingModal's own
    // doc comment -- the notice now sits ON TOP OF those buttons rather
    // than replacing them) moves on without recovering, but it isn't a
    // decision to throw the snapshot away either: main moves it aside as the
    // kept older snapshot (clearAutosaveNow, projectFile.ts), offered again
    // next launch, and this session's autosave is free to run.
    if (recoverableAutosave !== null) {
      clearAutosaveNow()
      setRecoverableAutosave(null)
      // Replaced on disk by the one just moved aside.
      setRecoverablePrevious(null)
    }
    closeWelcome(dontShowAgain)
  }

  function closeWelcome(dontShowAgain: boolean): void {
    setShowOnboarding(false)
    setOnboardingDismissedForSession(true)
    if (!dontShowAgain) return
    try {
      localStorage.setItem(ONBOARDING_SEEN_STORAGE_KEY, '1')
    } catch {
      // localStorage unavailable (e.g. private mode) -- just means it'll
      // show again next launch, not worth surfacing as an error.
    }
  }

  /** Settings-menu entry point -- clears the persisted "don't show again"
   * opt-out (so it resumes showing on every future launch, matching what
   * "re-enable" implies) AND reopens it immediately, rather than only doing
   * one or the other. */
  function showWelcomeAgain(): void {
    try {
      localStorage.removeItem(ONBOARDING_SEEN_STORAGE_KEY)
    } catch {
      // localStorage unavailable -- it just won't auto-show again next
      // launch either way; still open it now.
    }
    setOnboardingDismissedForSession(false)
    setShowOnboarding(true)
  }

  const [tourStepIndex, setTourStepIndex] = useState<number | null>(null)
  // The demo rifff's own groupId, once imported -- tracked so endTour can
  // delete exactly that rifff (and nothing the user may have added mid-
  // tour) rather than assuming it's the only thing on the timeline.
  const tourDemoGroupIdRef = useRef<string | null>(null)

  // Read lazily in useState's initializer, same "can't flash open-then-
  // closed" reasoning as showOnboarding below -- OnboardingModal's
  // tourSeen prop needs the real persisted value on its very first render,
  // not a default that flips a moment later.
  const [tourSeen, setTourSeen] = useState(() => {
    try {
      return localStorage.getItem(TOUR_SEEN_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  // OnboardingModal's "log into endlesss" button should disappear once the
  // user is already authenticated -- unlike tourSeen above (a synchronous
  // localStorage read), this is a real IPC round trip, so it can't be known
  // at first render. Defaults false (button shown) and flips once the fetch
  // resolves; same TransportBar.tsx endlesssAuthStatus() bridge call and
  // error handling as its own settings-menu fetch (see handleOpenSettingsMenu
  // there), just fired once on mount here instead of on-demand. A brief
  // flash of the button before it disappears on a slow fetch is an
  // acceptable, undramatic tradeoff -- not worth blocking the modal's first
  // render on.
  const [endlesssLoggedIn, setEndlesssLoggedIn] = useState(false)
  useEffect(() => {
    void window.rifffApi
      .endlesssAuthStatus()
      .then((status) => setEndlesssLoggedIn(status.loggedIn))
      .catch((err) => {
        console.error('Frame: endlesssAuthStatus() failed:', err)
      })
  }, [])

  // Single source of truth for Discover's whole-library background scan
  // consent -- TransportBar's settings-menu revoke/re-enable toggle reads
  // it (via toggleDiscoverConsent below), DiscoverLibraryScan's own mount
  // just below is gated directly on it, and DiscoverPanel.tsx's one-time
  // consent prompt now reads/writes this SAME state (threaded down through
  // LibraryBrowser.tsx, same lift-up-and-thread-down pattern already used
  // for discoverSlots/discoverChaos there) rather than keeping its own
  // independently-fetched copy, which used to let the two go out of sync
  // (toggling consent from the settings menu while Discover was already
  // open didn't affect the already-mounted scan until DiscoverPanel next
  // remounted). Loaded once here, same "fetch on mount" pattern as
  // endlesssLoggedIn just above.
  // The whole DiscoverSettings object is mirrored (not just consent) so
  // every save MERGES -- saving a partial object used to be fine with one
  // field, but would silently wipe traitMatchBar (2026-09-22) otherwise.
  const [discoverSettings, setDiscoverSettingsState] = useState<DiscoverSettings>({
    consentedToLibraryScan: false,
    traitMatchBar: DEFAULT_TRAIT_BAR,
    radio: DEFAULT_RADIO_SETTINGS,
    radioView: DEFAULT_RADIO_VIEW
  })
  const discoverConsented = discoverSettings.consentedToLibraryScan
  const traitMatchBar = discoverSettings.traitMatchBar
  const radioSettings = discoverSettings.radio
  const radioView = discoverSettings.radioView
  // The latest settings, always current: every save merges onto this, never onto a render's
  // `discoverSettings`. A control can commit late through an older render's callback (a radio
  // bar's click waits out the double-click window), and merging onto that render's copy rolled
  // back a save made in between, e.g. the view switch (latestSettings.ts).
  const discoverSettingsRef = useRef<DiscoverSettings>(discoverSettings)
  useEffect(() => {
    void window.rifffApi
      .getDiscoverSettings()
      .then((s) => {
        discoverSettingsRef.current = s
        setDiscoverSettingsState(s)
      })
      .catch((err) => {
        console.error('Frame: getDiscoverSettings() failed:', err)
      })
  }, [])

  async function updateDiscoverSettings(patch: Partial<DiscoverSettings>): Promise<void> {
    const next = mergeLatestSettings(discoverSettingsRef, patch)
    setDiscoverSettingsState(next)
    await window.rifffApi.setDiscoverSettings(next)
  }

  /** Settings menu's "trait match" entry -- steps loosest to strictest,
   * then wraps (nextTraitMatchBar). */
  async function cycleTraitMatchBar(): Promise<void> {
    await updateDiscoverSettings({
      traitMatchBar: nextTraitMatchBar(discoverSettingsRef.current.traitMatchBar)
    })
  }

  /** The one real setter for discoverConsented -- updates the local mirror
   * AND persists, so every caller (TransportBar's toggle below, and
   * DiscoverPanel's "yes, analyze" button via the prop threaded down
   * through LibraryBrowser) goes through the same path rather than each
   * keeping its own persistence logic. */
  async function setDiscoverConsented(value: boolean): Promise<void> {
    await updateDiscoverSettings({ consentedToLibraryScan: value })
  }

  async function toggleDiscoverConsent(): Promise<void> {
    await setDiscoverConsented(!discoverSettingsRef.current.consentedToLibraryScan)
  }

  /** The one real setter for every radio control (start prompt, strip) -- patches the
   * nested object and routes through updateDiscoverSettings, which MERGES
   * (saving a partial object "would silently wipe traitMatchBar", see its
   * own doc comment above). */
  async function setRadioSettings(patch: Partial<RadioSettings>): Promise<void> {
    await updateDiscoverSettings(nestedPatchFromLatest(discoverSettingsRef, 'radio', patch))
  }

  /** The radio view's simple / advanced switch (spec 2026-10-05-radio-simple-view-design). Its
   * own field, so `radio` keeps its identity and nothing radio does re-runs on a switch. */
  async function setRadioView(view: RadioView): Promise<void> {
    await updateDiscoverSettings({ radioView: view })
  }

  async function startTour(): Promise<void> {
    // Puts the app into the one view every step's anchor is actually
    // mounted in: 'sketch' swaps the whole Timeline out for SketchStrip and
    // 'map' swaps it out for ArrangementMap -- either one leaves the ruler
    // and every clip missing, so those steps would spotlight nothing and
    // fall back to a centred callout. This used to take two dispatches,
    // one per view flag; the map being the third ArrangerMode makes it one.
    // The tour then places a demo rifff below, which is what makes the clip
    // step's anchor exist at all on a fresh, empty project.
    dispatch({ type: 'SET_ARRANGER_MODE', mode: 'normal' })
    const rifff = await window.rifffApi.importDemoRifff()
    if (!rifff) return
    tourDemoGroupIdRef.current = rifff.groupId
    dispatch({ type: 'ADD_TO_SHELF', rifff })
    dispatch({ type: 'PLACE_ON_TIMELINE', groupId: rifff.groupId, startBar: 0 })
    setTourStepIndex(0)
    setTourSeen(true)
    try {
      localStorage.setItem(TOUR_SEEN_STORAGE_KEY, '1')
    } catch {
      // localStorage unavailable -- welcome will just keep offering the
      // tour link every launch, not worth surfacing as an error.
    }
  }

  function endTour(): void {
    if (tourDemoGroupIdRef.current) {
      dispatch({ type: 'DELETE_RIFFFS', groupIds: [tourDemoGroupIdRef.current] })
      tourDemoGroupIdRef.current = null
    }
    setTourStepIndex(null)
  }

  /** Gear-menu "take the tour" entry (TransportBar.tsx) -- a deliberate
   * replay, always offered regardless of tourSeen. Confirms first when
   * there's real content to protect, same guard as the welcome modal's own
   * onStartTour handler below (which can't just call this directly --
   * that one also needs to dismiss the modal first). */
  function replayTour(): void {
    const hasExistingContent = Object.keys(state.rifffs).length > 0
    if (
      hasExistingContent &&
      !window.confirm('start the tour? this adds a demo rifff to your current sketch.')
    ) {
      return
    }
    void startTour()
  }
  const [libraryBrowserOpen, setLibraryBrowserOpen] = useState(false)
  // Opening one of these two full-screen library modals must close the
  // other -- both render as position:fixed;inset:0 overlays at the same
  // z-index (LibraryBrowser.tsx's own LORE modal, ProjectLibraryBrowser.tsx's
  // sssketch modal), so nothing previously stopped both being mounted at
  // once. With both open, whichever renders on top fully occludes the
  // other -- a real reported bug where "switching" to the other library
  // looked like it showed the wrong/broken content, when actually the
  // first modal was just still open underneath.
  function openLibraryBrowser(): void {
    setRiffLibraryOpen(false)
    setLibraryBrowserOpen(true)
  }
  // Which half the riff library should open on. No longer nullable: every
  // path that opens the browser now names its half outright (the two shelf
  // buttons via openRiffLibrary just below, the Discover-seed path further
  // down), so there is no "decide as usual" case left for the browser to
  // infer -- see LibraryBrowser's own initialMode doc for what that
  // inference was and why losing it is the point. Consumed once per open,
  // because LibraryBrowser mounts fresh every time; the initial value here
  // is never observed, since nothing renders the browser until an opener
  // has run.
  const [riffLibraryInitialMode, setRiffLibraryInitialMode] = useState<LibraryMode>('browse')
  /**
   * The one opener behind both shelf buttons. Each door names the half it
   * opens on (libraryModeForEntryPoint) rather than leaving it to the
   * browser's own "open where you left off" rule -- the whole point of
   * splitting the single import button in two is that a button takes you
   * straight where you meant to go. Direct request, 2026-09-23: "import and
   * discover ... i think they should be distinct buttons instead of tabs."
   */
  function openRiffLibrary(entry: LibraryEntryPoint): void {
    shapePreviewStopRef.current?.()
    setLibraryBrowserOpen(false)
    setRiffLibraryInitialMode(libraryModeForEntryPoint(entry))
    setRiffLibraryOpen(true)
  }

  /**
   * "do it for me", and every move listed under "stuck?".
   *
   * Phase two has no moves at all any more: the map arrives whole and what
   * its sections should become is the user's call, so "do it for me" is
   * disabled for the whole arrangement phase by construction. The
   * 'section-op' kind, and the bridge that carried it to the old
   * one-section-at-a-time panel, went with that panel on 2026-09-23.
   * Phase three's two wires stay: the tension ops reach
   * SssketchyTensionPanel (unqueued, mounted only on p3-tension) and the
   * export ops reach ProjectMenu's own three menu entries, so the flow
   * never grows an export path of its own.
   *
   * An exhaustive SWITCH, not an if-chain with a fallthrough. This was the
   * latter, which meant every kind other than the first landed on the
   * lock-climax dispatch -- fine while there were only two kinds, and a
   * silent wrong answer the moment a third arrived: every phase-two "do it
   * for me" would have quietly re-locked the climax instead of carving.
   * The `never` default makes the next new kind a typecheck failure here
   * rather than a mystery at runtime.
   */
  function handleCoachMove(action: CoachMoveAction): void {
    switch (action.kind) {
      case 'lock-climax':
        dispatch({ type: 'COACH_LOCK_CLIMAX', now: Date.now(), slots: coachSlots, bpm: state.bpm })
        return
      case 'tension-op':
        requestCoachTensionOp(action.op)
        return
      case 'transport-op':
        // "play the whole track with the gain controls to hand" (spec). The
        // whole track, so from bar 0 -- and through the ordinary transport,
        // because the balance check listens to the REAL project, not to a
        // throwaway preview. While already playing the engine is told
        // directly (and the tick guard armed), the same shape Ruler.tsx's
        // seekTo uses: without it the renderer would jump to bar 0 and the
        // next 30Hz tick would drag the playhead straight back.
        dispatch({ type: 'SET_POS', pos: 0 })
        if (playing) {
          markManualSeek()
          void window.rifffApi.engineSetPosition(0)
        } else {
          dispatch({ type: 'PLAY' })
        }
        return
      case 'export-op':
        requestCoachExport(action.op)
        return
      default: {
        const _exhaustive: never = action
        return _exhaustive
      }
    }
  }
  // Shelf's own onSeedDiscover -- see its own doc comment for why this
  // lives here (App.tsx is the one place with access to both Shelf and
  // LibraryBrowser). Now seeds discoverSlots/etc. directly (they live here
  // -- see their own doc comment above) rather than routing through a
  // "pending seed" LibraryBrowser used to consume once at mount. Confirms
  // before overwriting real existing Discover content -- same
  // window.confirm convention LibraryBrowser.tsx's own
  // seedDiscoverFromBrowseRiff already uses for the identical risk,
  // applied here too now that it's a real possibility (previously
  // LibraryBrowser always mounted fresh on open, so there was never
  // anything to lose).
  async function openRiffLibraryWithDiscoverSeed(rifff: Rifff): Promise<void> {
    const hasRealContent = discoverHasRealContent(discoverSlots)
    if (
      hasRealContent &&
      !window.confirm(
        "replace the current discover loop with this riff's stems? whatever you've built so far in discover will be lost."
      )
    ) {
      return
    }
    shapePreviewStopRef.current?.()
    // Discover's library/Keep formats do not carry runtime phase, so the
    // exact effective phase of every source stem is made physical first, as
    // one immutable all-or-nothing batch, and Discover is seeded from those
    // files. Auditioning a riff in Discover must not edit the project: this
    // renders the bake without adopting it into the riff (no APPLY_BAKE), as
    // Cross does for its parents, so opening Discover leaves the project
    // saved and its undo history alone. A riff with no live phase is used as
    // it is.
    // Can reject (the bake IPC failing outright); callers fire this and
    // forget, so a rejection here would vanish without a word.
    let seedRifff: Rifff | null
    try {
      seedRifff = await rifffForSketchCross(rifff, state.off, SNAP_DIVS[state.snapIdx], (jobs) =>
        window.rifffApi.bakeOffset(jobs)
      )
    } catch (err) {
      console.error('App: failed to prepare a riff for Discover:', err)
      window.alert('could not prepare this riff for discover. nothing was changed; try again.')
      return
    }
    if (!seedRifff) {
      window.alert('could not prepare every stem for discover. nothing was changed; try again.')
      return
    }
    // Which jam each seed stem's original is from, so candidates rolled from the same jam can be
    // baked by the seed's rotation. If the lookup fails, only the seed's own stems are known.
    let seedPhase: DiscoverSeedPhase | null = null
    try {
      const originals = seedRifff.stems.map((stem) => phaseLineage(stem).sourcePath)
      const { jams, names } = await window.rifffApi.riffLibraryStemJams(originals)
      seedPhase = seedPhaseOfStems(seedRifff.stems, jams, names)
    } catch (err) {
      console.error("App: couldn't look up the Discover seed's jams:", err)
      seedPhase = seedPhaseOfStems(seedRifff.stems, {})
    }

    setLibraryBrowserOpen(false)
    // Says 'discover' outright rather than leaving the browser to infer it
    // from the slots seeded on the next line. That inference used to be the
    // only signal and got this wrong once already (see discoverSeed.ts's own
    // note on the narrower `candidate !== null` check landing a seeded open
    // on 'browse'); now that every opener names its half, this one should
    // too.
    setRiffLibraryInitialMode('discover')
    const sourceGainBySlot = Object.fromEntries(
      rifff.stems.map((stem) => [stem.slot, state.vol[stemKey(rifff.groupId, stem.slot)] ?? 1])
    )
    setDiscoverSlots(buildSeedSlotsFromStems(seedRifff.stems, sourceGainBySlot))
    setDiscoverChaos(DEFAULT_DISCOVER_CHAOS)
    setDiscoverUndoStack([[]])
    setDiscoverRedoStack([])
    setDiscoverSeedBpm(rifff.bpm)
    setDiscoverSeedPhase(seedPhase)
    setRiffLibraryOpen(true)
  }

  /** Opens Cross from exactly the two riffs selected in Sketch or Shelf. Cross is a
   * peer music-making workspace to Discover, not a library/import action:
   * its parents are the two project riffs exactly as currently heard. */
  async function openCrossFromRiffs([left, right]: [Rifff, Rifff]): Promise<void> {
    const projectKey = crossProjectKey(currentSketch, state.projectSeed)
    const selectedIds = new Set([left.groupId, right.groupId])
    const existingIds = new Set(crossDraft?.parents.map((parent) => parent.id) ?? [])
    const samePair =
      crossDraft?.projectKey === projectKey &&
      existingIds.size === 2 &&
      [...selectedIds].every((id) => existingIds.has(id))

    shapePreviewStopRef.current?.()
    stopActivePreview()
    dispatch({ type: 'PAUSE' })
    if (samePair) {
      setCrossOpen(true)
      return
    }
    setBusy('preparing cross…')
    try {
      const prepared = await Promise.all(
        [left, right].map((rifff) =>
          rifffForSketchCross(rifff, state.off, SNAP_DIVS[state.snapIdx], (jobs) =>
            window.rifffApi.bakeOffset(jobs)
          )
        )
      )
      if (!prepared[0] || !prepared[1]) {
        window.alert('could not prepare every stem for cross. nothing was changed; try again.')
        return
      }
      setCrossDraft({
        ...createCrossDraft(
          projectKey,
          crossParentFromRifff(prepared[0], state.vol),
          crossParentFromRifff(prepared[1], state.vol),
          state.bpm
        ),
        // Cross and Discover expose the same source choice (instruments↔recorded). Seed a
        // disposable Cross draft from the persisted setting rather than
        // resetting the knob whenever a new pair is opened.
        sourceLean: radioSourceOf(discoverSettingsRef.current.radio)
      })
      setCrossOpen(true)
    } catch (err) {
      console.error('App: failed to prepare selected riffs for Cross:', err)
      window.alert(
        'could not prepare the selected riffs for cross. nothing was changed; try again.'
      )
    } finally {
      setBusy(null)
    }
  }

  async function openShapeFromRifff(rifff: Rifff): Promise<void> {
    const generation = ++shapeOpenGenerationRef.current
    const projectKey = shapeProjectKey(projectSessionEpochRef.current)
    shapeOpeningSelectionRef.current = {
      ids: new Set(selectedRiffIds),
      anchorId: riffSelectionAnchorId
    }
    stopActivePreview()
    shapePreviewStopRef.current?.()
    dispatch({ type: 'PAUSE' })
    setBusy('preparing edit…')
    try {
      const prepared = await rifffForSketchCross(
        rifff,
        state.off,
        SNAP_DIVS[state.snapIdx],
        (jobs) => window.rifffApi.bakeOffset(jobs)
      )
      if (shapeOpenGenerationRef.current !== generation) return
      if (shapeProjectKeyRef.current !== projectKey) {
        shapeOpeningSelectionRef.current = null
        return
      }
      if (!prepared) {
        shapeOpeningSelectionRef.current = null
        window.alert('could not prepare every stem for EEEDIT. nothing was changed; try again.')
        return
      }
      // A nonzero runtime Re-1 was physically baked above. That establishes
      // a fresh incoming baseline: an older Shape recipe points at the
      // pre-bake source coordinates and must not silently discard the phase
      // adjustment when this riff is reopened.
      const baseline =
        prepared === rifff
          ? prepared
          : {
              ...prepared,
              stems: prepared.stems.map((stem) => ({ ...stem, shape: undefined }))
            }
      const nextDraft = createShapeDraft(projectKey, baseline, state.vol, undefined, state.bpm)
      setShapeDraft(nextDraft)
      shapeSavedFingerprintRef.current = shapeContentFingerprint(nextDraft)
      setShapeDirty(false)
      shapePublishedRiffIdRef.current = null
      setShapeOpen(true)
    } catch (err) {
      if (shapeOpenGenerationRef.current !== generation) return
      shapeOpeningSelectionRef.current = null
      console.error('App: failed to prepare riff for Shape:', err)
      window.alert(err instanceof Error ? err.message : 'could not open EEEDIT.')
    } finally {
      if (shapeOpenGenerationRef.current === generation) setBusy(null)
    }
  }

  function shapeDraftIsCurrent(draft: ShapeDraft): boolean {
    return (
      shapeOpenRef.current &&
      shapeDraftRef.current?.id === draft.id &&
      shapeDraftRef.current.revision === draft.revision &&
      shapeProjectKeyRef.current === draft.projectKey
    )
  }

  async function materializeCurrentShape(draft: ShapeDraft): Promise<ShapeAssembly | null> {
    const projectKey = shapeProjectKey(projectSessionEpochRef.current)
    if (draft.projectKey !== projectKey)
      throw new Error('this EEEDIT draft belongs to another project.')
    const jobId = `${draft.id}:${draft.revision}:commit:${crypto.randomUUID()}`
    const result = await window.rifffApi.materializeShape({
      jobId,
      mode: 'commit',
      targetBpm: draft.targetBpm,
      loopBars: draft.loopBars,
      lanes: draft.lanes.map((lane) => ({
        source: lane.source,
        segments: shapeRenderSegments(lane)
      }))
    })
    if (!shapeDraftIsCurrent(draft)) {
      await window.rifffApi.cleanupUncommittedShapeAssets(result.stems.map((stem) => stem.path))
      return null
    }
    return assembleShapeRifff(draft, result.stems)
  }

  // One EEEDIT publish at a time (publishGate.ts).
  const shapePublishGateRef = useRef(createPublishGate())
  const trackShapePublish = <T,>(work: () => Promise<T>): Promise<T> =>
    shapePublishGateRef.current.track(work)

  async function publishShape(
    draft: ShapeDraft,
    destination: 'keep' | 'shelf' | 'timeline'
  ): Promise<'✓ kept' | 'already kept' | void> {
    // Queued behind any publish in flight (a departure save's included); the check runs once it
    // is this one's turn, so it sees everything published before it.
    return trackShapePublish(async () => {
      // A departure save that ran meanwhile already added exactly this draft to the shelf, and
      // that riff is still there: adding it again would duplicate it. If it was deleted since,
      // add it again.
      const publishedId = shapePublishedRiffIdRef.current
      if (
        destination === 'shelf' &&
        publishedId !== null &&
        stateRef.current.rifffs[publishedId] !== undefined &&
        shapeContentFingerprint(draft) === shapeSavedFingerprintRef.current
      )
        return
      setBusy(destination === 'keep' ? 'keeping the edit…' : 'adding the edit…')
      try {
        return await publishShapeNow(draft, destination)
      } finally {
        setBusy(null)
      }
    })
  }

  async function publishShapeNow(
    draft: ShapeDraft,
    destination: 'keep' | 'shelf' | 'timeline'
  ): Promise<'✓ kept' | 'already kept' | void> {
    try {
      const assembled = await materializeCurrentShape(draft)
      if (!assembled) return
      if (destination === 'keep') {
        let saved: Awaited<ReturnType<typeof window.rifffApi.saveDiscoveredRifff>> = null
        try {
          saved = await window.rifffApi.saveDiscoveredRifff(
            assembled.rifff.stems.map((stem) => ({
              path: stem.path,
              gain: assembled.vol[stemKey(assembled.rifff.groupId, stem.slot)] ?? 1,
              name: stem.name,
              author: stem.author,
              barLength: stem.barLength,
              durationSec: stem.durationSec
            })),
            assembled.rifff.bpm,
            assembled.rifff.barLength,
            []
          )
        } finally {
          await window.rifffApi.cleanupUncommittedShapeAssets(
            assembled.rifff.stems.map((stem) => stem.path)
          )
        }
        if (!shapeDraftIsCurrent(draft)) return
        if (!saved || !('duplicate' in saved)) throw new Error('could not keep the edited riff.')
        shapeSavedFingerprintRef.current = shapeContentFingerprint(draft)
        setShapeDirty(false)
        return saved.duplicate ? 'already kept' : '✓ kept'
      }
      if (destination === 'shelf') {
        const action = { type: 'ADD_TO_SHELF' as const, rifff: assembled.rifff, vol: assembled.vol }
        // A save right after must write this result even before React renders it.
        stateRef.current = reducer(stateRef.current, action)
        dispatch(action)
        shapePublishedRiffIdRef.current = assembled.rifff.groupId
        setRiffSelection({
          ids: new Set([assembled.rifff.groupId]),
          anchorId: assembled.rifff.groupId
        })
      } else {
        const ends = Object.values(state.rifffs)
          .filter((rifff) => rifff.startBar !== undefined)
          .map(
            (rifff) =>
              (rifff.startBar ?? 0) +
              resolvedPlayedBarsFromFields(state.playedBars[rifff.groupId], rifff.barLength)
          )
        const action = {
          type: 'PLACE_LOOP_ON_TIMELINE' as const,
          stems: [assembled.rifff],
          startBar: ends.length > 0 ? Math.max(...ends) : 0,
          vol: assembled.vol
        }
        stateRef.current = reducer(stateRef.current, action)
        dispatch(action)
      }
      shapeSavedFingerprintRef.current = shapeContentFingerprint(draft)
      setShapeDirty(false)
    } catch (err) {
      console.error('App: failed to save Shape result:', err)
      window.alert('could not render every edited stem. the source riff was not changed.')
      throw err
    }
  }

  /** The save before something that closes or replaces the live project (quit's
   * Save, and Save in the discard guard before New or opening another), and the
   * Save item while EEEDIT is open, without telling the user anything itself. An unpublished EEEDIT draft is first
   * materialized onto the shelf, and that exact reducer result is what gets
   * written. 'saved' only when the write holds the newest edits, the draft's
   * included; a draft that changed meanwhile reads as 'changed'. */
  async function saveProjectBeforeLeavingNow(): Promise<SaveOutcome> {
    if (shapeDepartureSaveRef.current) return { kind: 'busy' }
    shapeDepartureSaveRef.current = true
    try {
      // Queued behind an add to shelf already running; this save then finds the draft published.
      return await trackShapePublish(departureSaveNow)
    } finally {
      shapeDepartureSaveRef.current = false
    }
  }

  async function departureSaveNow(): Promise<SaveOutcome> {
    const draft = shapeDraftRef.current
    const draftFingerprint = draft ? shapeContentFingerprint(draft) : null
    const departureSnapshot = {
      projectKey: shapeProjectKeyRef.current,
      draftId: draft?.id ?? null,
      fingerprint: draftFingerprint
    }
    const shapeSessionIsUnchanged = (): boolean => {
      const current = shapeDraftRef.current
      return (
        shapeProjectKeyRef.current === departureSnapshot.projectKey &&
        (current?.id ?? null) === departureSnapshot.draftId &&
        (current ? shapeContentFingerprint(current) : null) === departureSnapshot.fingerprint
      )
    }
    const needsShapePublish =
      draft !== null && draftFingerprint !== shapeSavedFingerprintRef.current

    setDepartureSaveBusy(true)
    setBusy(needsShapePublish ? 'saving edit…' : 'saving…')
    try {
      if (!needsShapePublish || !draft || draftFingerprint === null) {
        const outcome = await saveProjectNow()
        if (outcome.kind === 'saved' && !shapeSessionIsUnchanged()) return { kind: 'changed' }
        return outcome
      }
      let savedState: AppState
      try {
        const assembled = await materializeCurrentShape(draft)
        if (!assembled || !shapeDraftIsCurrent(draft)) return { kind: 'changed' }
        const action = {
          type: 'ADD_TO_SHELF' as const,
          rifff: assembled.rifff,
          vol: assembled.vol
        }
        savedState = reducer(stateRef.current, action)
        // The disk save below must serialize and validate the exact shelf
        // result even before React has had a chance to render the dispatched
        // action. Keep the live mirror transactionally in step with it.
        stateRef.current = savedState
        dispatch(action)
        shapePublishedRiffIdRef.current = assembled.rifff.groupId
        setRiffSelection({
          ids: new Set([assembled.rifff.groupId]),
          anchorId: assembled.rifff.groupId
        })
        shapeSavedFingerprintRef.current = draftFingerprint
        setShapeDirty(false)
      } catch (err) {
        console.error('App: failed to publish the EEEDIT draft during project save:', err)
        return {
          kind: 'failed',
          error: "couldn't add the edited riff to the shelf, so the project wasn't saved"
        }
      }
      const outcome = await saveProjectNow(savedState)
      if (
        outcome.kind === 'saved' &&
        !(shapeSessionIsUnchanged() && shapeProjectKeyRef.current === draft.projectKey)
      )
        return { kind: 'changed' }
      return outcome
    } finally {
      setDepartureSaveBusy(false)
      setBusy(null)
    }
  }

  function closeShape(): void {
    const currentDraft = shapeDraftRef.current
    if (
      currentDraft &&
      shapeContentFingerprint(currentDraft) !== shapeSavedFingerprintRef.current
    ) {
      setShapeDiscardPromptOpen(true)
      return
    }
    finishCloseShape()
  }

  function finishCloseShape(): void {
    setShapeDiscardPromptOpen(false)
    shapeOpenGenerationRef.current += 1
    shapePreviewStopRef.current?.()
    shapePreviewStopRef.current = null
    const opening = shapeOpeningSelectionRef.current
    shapeOpeningSelectionRef.current = null
    setShapeOpen(false)
    setShapeDraft(null)
    const publishedId = shapePublishedRiffIdRef.current
    shapePublishedRiffIdRef.current = null
    if (publishedId && state.rifffs[publishedId]) {
      setRiffSelection({ ids: new Set([publishedId]), anchorId: publishedId })
      dispatch({ type: 'SELECT', groupId: publishedId })
      return
    }
    if (opening) {
      const valid = new Set([...opening.ids].filter((id) => state.rifffs[id] !== undefined))
      setRiffSelection({
        ids: valid,
        anchorId: opening.anchorId && valid.has(opening.anchorId) ? opening.anchorId : null
      })
      const inspectorId =
        opening.anchorId && valid.has(opening.anchorId) ? opening.anchorId : [...valid][0]
      if (inspectorId) dispatch({ type: 'SELECT', groupId: inspectorId })
    }
  }

  const [clusterStemsOpen, setClusterStemsOpen] = useState(false)
  // Which stems the open Tidy Up pass is over -- see TidyUpPopulation
  // (ClusterStemsBrowser.tsx). Every existing entry point means 'sketch';
  // only the gear menu's second item asks for the library.
  const [clusterStemsPopulation, setClusterStemsPopulation] = useState<TidyUpPopulation>('sketch')
  const openClusterStems = useCallback((population: TidyUpPopulation): void => {
    setClusterStemsPopulation(population)
    setClusterStemsOpen(true)
  }, [])
  const [autoArrangeOpen, setAutoArrangeOpen] = useState(false)
  const [drawArrangeOpen, setDrawArrangeOpen] = useState(false)
  // Every riff imported together as one LORE library batch, sharing the same
  // jam's clock phase, in their original import order — set alongside
  // pickerGroupId so BeatPicker opens on just the first one. Drives two
  // things: forward/back navigation between them while the picker's open
  // (see BeatPicker's onNavigate — auditioning a clearer-sounding rifff from
  // the same batch instead of being stuck with whichever happened to import
  // first), and onBaked's downbeat-propagation to "everyone else in the
  // batch" below, recomputed fresh from the CURRENT pickerGroupId each time
  // rather than a fixed "siblings" list captured once — otherwise navigating
  // away from the original first riff would exclude it from ever receiving
  // the bake, since it was never itself in a "siblings" list.
  //
  // Deliberately NOT cleared by onBaked (only by onClose) — onBaked needs
  // the full, still-intact list to compute "everyone else" at the moment it
  // runs, and onClose's own "was this actually a batch" check
  // (pickerBatchGroupIds.length > 1) needs to run before it gets cleared.
  // Empty for a single import or an unrelated re-pick via the Inspector's
  // own button.
  const [pickerBatchGroupIds, setPickerBatchGroupIds] = useState<string[]>([])
  // True only when the picker was opened straight off an import (Shelf drag-
  // drop or a LORE library batch) — false for the Inspector's own "re-pick
  // downbeat" button, which reopens an already-placed rifff for a deliberate
  // correction. Drives BeatPicker's close-confirmation: a wrong pick on a
  // brand-new import is easy to miss and harder to notice later, so that
  // path alone confirms before baking.
  const [pickerIsNewImport, setPickerIsNewImport] = useState(false)

  function handleImported(groupId: string): void {
    setPickerGroupId(groupId)
    setPickerIsNewImport(true)
  }

  function handleLibraryImported(groupIds: string[], rifffs?: Rifff[]): void {
    if (groupIds.length === 0) return
    // Default to whichever imported rifff looks easiest to pick a downbeat
    // against (see reOneScoring.ts) rather than just "whatever imported
    // first" — the existing batch prev/next nav in BeatPicker still lets the
    // user override this for any other rifff in the batch.
    const defaultGroupId =
      rifffs && rifffs.length > 1 ? (pickBestRifffForReOne(rifffs) ?? groupIds[0]) : groupIds[0]
    setPickerGroupId(defaultGroupId)
    setPickerBatchGroupIds(groupIds)
    setPickerIsNewImport(true)
  }

  // useCallback with no deps (both setters are stable) so openClipMenu below
  // can list it without losing the referential stability React.memo(ChannelRow)
  // depends on -- see openClipMenu's own comment.
  const handleOpenBeatPickerForEdit = useCallback(
    (groupId: string): void => {
      setPickerGroupId(groupId)
      setPickerIsNewImport(false)
    },
    [setPickerGroupId, setPickerIsNewImport]
  )
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    items: ContextMenuItem[]
  } | null>(null)
  // Remembers which groupId was copied, not a snapshot of it — paste always
  // reads the source's live current state, so copying then tweaking a volume
  // before pasting picks up that tweak (and pasting after the source was
  // deleted is just silently ignored).
  const [clipboard, setClipboard] = useState<string | null>(null)

  // The riser creation gesture, in its two halves.
  //
  // `riserArm` is set by the arranger's own menu and cleared the moment the
  // gesture resolves: while it is set, RiserExtentGesture is over the whole
  // arranger turning a drag into the new riser's start and length. Nothing is
  // dispatched until release, so an abandoned arm leaves the project exactly
  // as it was -- including the channel id minted here for a brand new row,
  // which is just a string until an ADD_RISER carries it.
  //
  // `openRiserLaneId` is the riser whose automation lane is open IN PLACE.
  // Drawing the sweep is the natural next thing to do after choosing a
  // riser's extent, so the lane opens on release -- but deliberately WITHOUT
  // turning state.automationLanes on, which would put every clip in the
  // project behind a lane and lose the user the place they were working in.
  // One riser's lane, opened on the riser they just made. RiserBlock reads
  // this alongside the global toggle (see its own `laneOpen`).
  const [riserArm, setRiserArm] = useState<{ channelId: string; isNewRow: boolean } | null>(null)
  const [openRiserLaneId, setOpenRiserLaneId] = useState<string | null>(null)
  const cancelRiserArm = useCallback((): void => setRiserArm(null), [])
  const closeRiserLane = useCallback((): void => setOpenRiserLaneId(null), [])
  // Reads `riserArm` straight out of the render that produced it, and
  // dispatches in its own body -- NOT from inside a setRiserArm updater,
  // which StrictMode double-invokes in development and which would therefore
  // create the riser twice (dragUtils.ts documents the real bug that rule
  // comes from). The gesture this belongs to only exists while riserArm is
  // set, so the closure cannot be stale by the time it is called.
  const createRiserFromGesture = useCallback(
    (startBar: number, lengthBars: number): void => {
      if (!riserArm) return
      // crypto.randomUUID, like every other freshly-minted id in this file.
      // It is also the riser's NOISE SEED (the engine hashes it -- see
      // riserSeedFor in NoiseRiser.h), so it has to be unique and it has to
      // be stable for the riser's whole life: two risers sharing an id would
      // sound like one doubled, and a riser whose id changed would change
      // texture under the user.
      const id = crypto.randomUUID()
      dispatch({
        type: 'ADD_RISER',
        riser: createRiser({ id, channelId: riserArm.channelId, startBar, lengthBars })
      })
      setRiserArm(null)
      setOpenRiserLaneId(id)
    },
    [dispatch, riserArm]
  )

  // Wrapped in useCallback, reading state via stateRef.current rather than
  // closing over the reactive `state` variable -- see stateRef's own doc
  // comment above for why (this is what lets Timeline's onOpenClipMenu prop
  // stay referentially stable, which React.memo(ChannelRow) depends on).
  const openClipMenu = useCallback(
    (x: number, y: number, groupId: string): void => {
      const state = stateRef.current
      const rifff = state.rifffs[groupId]
      if (!rifff) return
      // A rifff can be left with a live but never-actually-baked downbeat
      // correction — the main case being a LORE-sourced stem picked before
      // bakeOffset.ts could bake those at all (see its own doc comment).
      // Playback already accounts for it correctly (SchedulePlayback wraps
      // the offset), so this is a "clean up, not fix" action — only offered
      // when there's actually something to re-bake.
      const hasUnbakedOffset = (state.off[groupId] ?? 0) !== 0
      setContextMenu({
        x,
        y,
        items: [
          { label: 'copy', onClick: () => setClipboard(groupId) },
          {
            label: 'duplicate',
            onClick: () => {
              // Same class of bug live-reported 2026-09-17 ("two sections
              // were playing at the same time... i had extended the
              // original loop") and fixed the same way in DiscoverPanel.tsx's
              // own addToTimeline: rifff.barLength alone doesn't account
              // for a resize override (SET_PLAYED_BARS) -- placing the
              // duplicate right after the ORIGINAL's raw barLength, rather
              // than its actual (possibly longer, resized) played range,
              // would stack the copy on top of the original's own
              // still-playing tail.
              const action = pasteRifffAction(
                state,
                groupId,
                (rifff.startBar ?? 0) + resolvePlayedBars(state, groupId)
              )
              if (action) dispatch(action)
            }
          },
          // Meaningless for an already-single-stem rifff — nothing to split.
          ...(rifff.stems.length > 1
            ? [{ label: 'ungroup', onClick: () => dispatch({ type: 'UNGROUP', groupId }) }]
            : []),
          // The way to move a wrong loop start, and -- since APPLY_BAKE is
          // scoped by path rather than by groupId -- the way to move it on
          // every clip made of the same audio at once. Reached only through
          // the Inspector before now, which is a long way round from the
          // clip you are actually looking at, and invisible after a bake
          // (an already-baked clip has no offset left, so the re-bake entry
          // below is hidden). Deliberately the SAME gesture and the same
          // wording as the Inspector's own button rather than a second way
          // to set a downbeat.
          {
            label: 'pick loop start',
            onClick: () => handleOpenBeatPickerForEdit(groupId)
          },
          ...(hasUnbakedOffset
            ? [
                {
                  label: 're-bake downbeat',
                  onClick: () => {
                    void rebakeRifff(dispatch, state, groupId)
                  }
                }
              ]
            : []),
          {
            label: 'delete',
            danger: true,
            onClick: () => dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId })
          }
        ]
      })
    },
    [dispatch, handleOpenBeatPickerForEdit]
  )

  // Wrapped in useCallback for the same reason openClipMenu is: Timeline
  // passes it straight down to React.memo(ChannelRow), which only pays off
  // while its props stay referentially stable across unrelated dispatches.
  const openRiserMenu = useCallback(
    (x: number, y: number, riserId: string): void => {
      setContextMenu({
        x,
        y,
        items: [
          {
            label: 'remove riser',
            danger: true,
            onClick: () => dispatch({ type: 'REMOVE_RISER', id: riserId })
          }
        ]
      })
    },
    [dispatch]
  )

  function openPasteMenu(x: number, y: number, bar: number, channelId: string | null): void {
    const items: ContextMenuItem[] = []
    // Dropping a riser lives here, on the arranger's own background menu,
    // rather than as a button somewhere: it is "put a thing at this point on
    // this row", and the point and the row are exactly what a right-click
    // already carries. Same place, and the same gesture, as pasting a clip.
    //
    // What the menu item itself does changed on 2026-09-23 ("the flow for
    // creating a riser needs some help though... the initial sizing is what
    // needs work... prompt the user to select the width first, then draw the
    // line"): it no longer PLACES anything. It arms the extent gesture, and
    // the drag that follows is what creates the riser -- so the bar the
    // right-click landed on stops mattering entirely, which is why it is no
    // longer passed on. See RiserExtentGesture.
    if (channelId) {
      items.push({
        label: 'add riser -- drag its length',
        onClick: () => setRiserArm({ channelId, isNewRow: false })
      })
    } else {
      // The empty space below the last row -- the one place a right-click
      // carries a bar but no row, which makes it exactly the right home for
      // "put a riser on a row of its own" (Elling, 2026-09-23: "give the
      // riser ... its own channel", one row per riser, because he wants
      // making them to be easy). ADD_RISER puts the new channel id into
      // channelOrder itself, so the row appears at the bottom, where the
      // click was.
      //
      // TWO ids, not one reused: the riser's id is a noise seed with its own
      // stability contract (see createRiserFromGesture), and the channel id
      // is a row identity that the reducer matches against channelOf/
      // channelOrder. Keeping them separate means neither ever has to care
      // what the other means. The channel id is minted HERE, at arm time, so
      // the gesture knows which row it is drawing on before the row exists;
      // an abandoned gesture simply throws the string away.
      items.push({
        label: 'add riser on a new row -- drag its length',
        onClick: () => setRiserArm({ channelId: crypto.randomUUID(), isNewRow: true })
      })
    }
    if (clipboard && state.rifffs[clipboard]) {
      items.push({
        label: 'paste',
        onClick: () => {
          const action = pasteRifffAction(state, clipboard, bar)
          if (action) dispatch(action)
        }
      })
    }
    if (items.length === 0) return
    setContextMenu({ x, y, items })
  }

  // Delete/Backspace removes the selected clip from the timeline. Skipped while
  // focus is in a text input (tempo field, etc.) so deleting a digit doesn't also
  // delete the clip.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      // A pending region selection always takes precedence over the
      // whole-clip delete below -- a user who just finished dragging a
      // region expects Delete to act on THAT, not blow away the entire
      // clip. See docs/superpowers/specs/2026-08-05-clip-region-mute-design.md.
      if (state.regionSelection) {
        const { stemKeys, startBar, endBar, mode } = state.regionSelection
        if (mode === 'mute') {
          dispatch({ type: 'ADD_MUTE_REGION', stemKeys, startBar, endBar })
        } else {
          for (const stemKey of stemKeys) {
            dispatch({ type: 'REMOVE_MUTE_REGION', stemKey, startBar, endBar })
          }
        }
        dispatch({ type: 'SET_REGION_SELECTION', selection: null })
        return
      }

      if (!state.sel) return
      const selectedRifff = state.rifffs[state.sel]
      // Unplaced (library-only) rifffs are Shelf's own domain — see its own
      // Delete handler (also owns multi-select batch delete there). This
      // handler only ever un-places an already-placed clip; deleting one
      // from the library entirely is a different action (DELETE_RIFFFS).
      if (!selectedRifff || selectedRifff.startBar === undefined) return
      // Sketch mode has its own Delete/Backspace handling (SketchStrip),
      // which also re-packs the remaining sequence via SEQUENCE_RIFFFS —
      // this handler firing too would remove the same rifff a second time
      // (a no-op) but skip that repack step, racing with SketchStrip's own.
      if (state.mode === 'sketch') return
      dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId: state.sel })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.sel, state.mode, state.rifffs, state.regionSelection, dispatch])

  // Escape cancels a pending region selection without changing anything --
  // see docs/superpowers/specs/2026-08-05-clip-region-mute-design.md.
  useEffect(() => {
    if (!state.regionSelection) return
    function handleEscape(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      dispatch({ type: 'SET_REGION_SELECTION', selection: null })
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [state.regionSelection, dispatch])

  // Space toggles play/pause, the standard DAW convention. Skipped only while
  // the beat-picker is open (it owns spacebar for tap-to-mark while it's up)
  // or focus is in a text field (typing a literal space). Deliberately does
  // NOT exempt a focused button/select the way the other shortcuts below
  // don't either — an earlier version did, so that after clicking almost any
  // button in the app (mute, solo, unlink...), the next spacebar press would
  // silently re-trigger that stale-focused button instead of toggling
  // playback, reading as "space sometimes does something else." Nothing in
  // this app relies on space-activates-the-focused-button (no native
  // <select> exists, and every button is mouse-driven), so there's no
  // legitimate behavior left to preserve there.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.code !== 'Space' || pickerGroupId) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      if (playing) {
        // Routes through confirmLockInIfRecording first (see its own doc
        // comment) rather than a bare dispatch -- pausing via spacebar is
        // one of the three ways direct feedback called out for silently
        // abandoning an uncommitted gated-recording pass.
        void (async () => {
          await confirmLockInIfRecording()
          dispatch({ type: 'PAUSE' })
        })()
      } else {
        dispatch({ type: 'PLAY' })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- confirmLockInIfRecording isn't memoized (fresh closure every render), but closes over nothing beyond state/dispatch, already covered by listing playing/pickerGroupId/dispatch -- listing it too would just re-bind the listener on every render instead of only when those actually change, with no safety benefit (same reasoning as the existing \\ key effect further down).
  }, [pickerGroupId, playing, dispatch])

  // Shared by the Titlebar view button and the Tab shortcut below.
  //
  // This used to block with an alert ("sketch mode requires a plain,
  // back-to-back arrangement...") when the cycle would have stayed put:
  // with only two views, an ineligible project's toggle went normal ->
  // normal, which read as broken rather than unavailable. The cycle now
  // always advances (normal -> map when sketch is ineligible — see
  // nextArrangerMode), so there's no longer a dead click to explain, and a
  // modal alert on a key the user is cycling through would be worse than
  // the silence it replaced. The reason sketch is unavailable stays where
  // it already was, in the button's own title text.
  function handleCycleArrangerMode(): void {
    dispatch({ type: 'SET_ARRANGER_MODE', mode: nextArrangerMode(state) })
  }

  // Tab cycles the arranger view, Ableton-style: arrange -> sketch -> map ->
  // arrange, skipping sketch when isSketchEligible(state) is false (see
  // nextArrangerMode). The automation lanes are deliberately NOT in this
  // cycle -- they are a toggle in the transport bar, laid over the arrange
  // view rather than replacing it. Skipped while focus is in a text input —
  // Tab's native move-to-next-field behavior is more useful there than the
  // arrangement's own view cycle (matches Delete/V/undo's same input-skip
  // pattern).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      handleCycleArrangerMode()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleCycleArrangerMode is a fresh closure every render (reads state directly); listing it would re-register this listener every render for no behavioral difference, since it always reads the CURRENT closure's state anyway
  }, [state, dispatch])

  // Cmd/Ctrl+Z to undo, Cmd/Ctrl+Shift+Z (and the Windows-convention Ctrl+Y) to
  // redo. Skipped while focus is in a text input, same as Delete above — undoing
  // mid-typing in the tempo field should edit the field's text, not the arrangement.
  // Only a TEXT input, though (native radio sound plan, Task 13 review): a slider,
  // checkbox or radio has no text of its own to undo, and a range input keeps focus
  // after a drag -- without this, Cmd+Z right after dragging a sound panel slider did
  // nothing at all. The other global shortcuts keep their broader guard.
  //
  // While Discover/radio or Cross is open it claims these keys (undoRouting.ts):
  // they drive that panel's own undo, not the project's, which would silently
  // undo arrangement edits hidden under the overlay. The import view's browse
  // mode claims them to do nothing, for the same reason.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const action = undoShortcutFor({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        target: e.target as HTMLInputElement | null
      })
      if (action === null) return
      e.preventDefault()
      const owner = undoRouter.current()
      if (owner) {
        // A held key waits for the owner's render (undoRouting.ts, createRepeatGate).
        if (action === 'redo') owner.redo(e.repeat)
        else owner.undo(e.repeat)
      } else if (action === 'redo') history.redo()
      else history.undo()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [history])

  // Cmd+0 resets zoom to its default level -- the standard "reset zoom"
  // convention across creative and browser apps. Cmd only, matching the
  // wheel-zoom trigger's own modifier (see handleTimelineWheel's comment).
  // Skipped while focus is in a text input, same pattern as every other
  // global shortcut here.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!e.metaKey || e.key !== '0') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      dispatch({ type: 'RESET_ZOOM' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch])

  // Cmd+S/Ctrl+S saves the current project -- the same handleSave() already
  // wired to the Save button, just a keyboard trigger for it. Skipped while
  // focus is in a text input, matching every other global shortcut here.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const key = e.key.toLowerCase()
      if (!(e.metaKey || e.ctrlKey) || key !== 's') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSave is a fresh closure every render (reads state/currentSketch directly), same reasoning as the Tab/gated-recording (\) handlers above: re-registering on every render would be wasteful without behavioral difference, since it always reads the CURRENT closure's state anyway.
  }, [state, currentSketch])

  // Keeps main's own rendererHasUnsavedChanges (index.ts) in sync so the
  // quit-time dialog (before-quit) knows whether to ask before discarding
  // real unsaved work. `dirty` only changes value on a real transition (see
  // its own declaration above), so this effect only fires then, not on
  // every keystroke.
  useEffect(() => {
    void window.rifffApi.setDirtyState(dirty || shapeDirty, shapeDirty)
  }, [dirty, shapeDirty])

  // Main pushes 'request-save-before-quit' when the user picks "Save" on
  // the native quit-time dialog (index.ts's before-quit handler) -- run the
  // same save the Save button/Cmd+S use, then report whether it landed AND
  // holds the newest edits (saveBeforeLeaving's rule). Main keeps the app
  // open on false or timeout, and says nothing itself on false: the notice
  // below is the user's explanation. It's shown only after main has its
  // answer, since an alert blocks the renderer and would otherwise run main
  // into its timeout and a misleading "still saving" dialog.
  useEffect(() => {
    return window.rifffApi.onRequestSaveBeforeQuit((requestId) => {
      void saveProjectBeforeLeavingNow().then(
        (outcome) => {
          window.rifffApi.notifySaveBeforeQuitComplete(requestId, outcome.kind === 'saved')
          const notice = saveOutcomeNotice(outcome, 'leaving')
          if (notice) window.alert(notice)
        },
        () => window.rifffApi.notifySaveBeforeQuitComplete(requestId, false)
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSave is a fresh closure every render (reads state/currentSketch directly), same reasoning as the Cmd+S effect just above: re-subscribing on every render would be wasteful without behavioral difference, since the listener always reads the CURRENT closure's state anyway.
  }, [state, currentSketch])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // e.repeat guards against the OS's own key-repeat re-firing keydown
      // continuously while held -- same convention as the Option/Alt handler
      // above (see its own comment). Without this, holding \ down fires
      // enableGatedRecording()/lockInGatedRecording() many times in rapid
      // succession instead of once per physical press.
      if (e.key !== '\\' || e.repeat) return
      // Recording off (the advanced features switch): \ is an ordinary key
      // -- unless a pass is already running, which it still locks in.
      if (!recordingOn && !state.gatedRecordingEnabled) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      void (state.gatedRecordingEnabled ? lockInGatedRecording() : enableGatedRecording())
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enableGatedRecording/lockInGatedRecording aren't memoized (fresh closures every render), but close over nothing beyond state/dispatch/playing, all effectively covered by `state` already being listed -- listing them too would just re-bind the listener on every render instead of only when state actually changes, with no safety benefit.
  }, [state, dispatch, recordingOn])

  // "/" adds a new recording channel -- same action as the "+ rec channel"
  // button below, just reachable without leaving the keyboard while
  // recording. Mirrors the "\" effect above exactly (ignore while typing
  // in an input/textarea, preventDefault so "/" itself never lands in a
  // focused field first).
  //
  // If an empty, unarmed recording channel ALREADY exists, pressing "/"
  // again is read as "I'm trying to record and it's not doing anything" --
  // per direct feedback, having to separately create a channel and then go
  // arm it felt like an extra manual step easy to forget. Rather than
  // creating ANOTHER unused channel, this points a brief reminder at the
  // existing one's rec-dot instead (ChannelRow.tsx's own
  // recordingArmReminderChannelId-driven tooltip) and leaves the actual
  // arming to an explicit click, so the placement-affecting
  // armedLoopRegion snapshot still only ever gets set through
  // handleToggleArm's own normal path.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== '/' || !recordingOn) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      const placedChannelIds = new Set(Object.values(state.channelOf))
      const existingUnarmedChannel = state.channelOrder.find(
        (id) =>
          state.recordingChannelIds[id] && !placedChannelIds.has(id) && id !== state.armedChannelId
      )
      if (existingUnarmedChannel) {
        dispatch({ type: 'SET_RECORDING_ARM_REMINDER', channelId: existingUnarmedChannel })
        window.setTimeout(() => {
          dispatch({ type: 'SET_RECORDING_ARM_REMINDER', channelId: null })
        }, 2500)
        return
      }
      dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: crypto.randomUUID() })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    recordingOn,
    dispatch,
    state.channelOf,
    state.channelOrder,
    state.recordingChannelIds,
    state.armedChannelId
  ])

  // Hold Cmd to pan the arranger view by dragging anywhere in it, rather
  // than having to grab the scrollbar directly.
  const handModeHeld = useHandModeHeld()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollbarInsets = useScrollbarInsets(scrollContainerRef, state.mode === 'normal')
  const [panning, setPanning] = useState(false)

  // Captured by handleTimelineWheel, consumed by the effect below once the
  // zoom multiplier actually changes and the DOM has re-rendered at the new
  // scale -- setting scrollLeft synchronously in the same handler that
  // dispatches the zoom change would compute against the OLD (pre-re-render)
  // scrollWidth and could get silently clamped by the browser before React
  // ever grows the content to the new width.
  const pendingZoomAnchorRef = useRef<{
    cursorXInContainer: number
    oldScrollLeft: number
    oldPpb: number
  } | null>(null)

  function handleTimelineWheel(e: WheelEvent<HTMLDivElement>): void {
    // Cmd only, not Ctrl -- Ctrl+scroll triggering too was reported flaky
    // on macOS trackpads (matching the same class of Ctrl-key quirk already
    // documented for one-shot resize's stretch modifier), and there's no
    // Windows build of this app to justify a Ctrl fallback anyway.
    if (!e.metaKey) return
    // Axis-locks the gesture: a mostly-horizontal trackpad swipe done while
    // the modifier happens to be held falls through as a normal pan instead
    // of jittering the zoom level from incidental deltaY noise -- only a
    // gesture that's actually more vertical than horizontal drives zoom.
    if (!isVerticalDominant(e.deltaX, e.deltaY)) return
    e.preventDefault()
    const container = scrollContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    pendingZoomAnchorRef.current = {
      cursorXInContainer: e.clientX - rect.left,
      oldScrollLeft: container.scrollLeft,
      oldPpb: ppb
    }
    const currentMultiplier = ppb / PPB
    dispatch({
      type: 'SET_ZOOM',
      multiplier: zoomMultiplierForWheelDelta(currentMultiplier, e.deltaY)
    })
  }

  // useLayoutEffect, not useEffect -- this must apply before the browser
  // paints the frame where the content already resized to the new ppb, or
  // that frame briefly shows un-anchored (content shifted, scroll not yet
  // corrected) before snapping into place on the next one. Was a plain
  // useEffect originally; reported as visible jank on every wheel tick.
  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current
    const container = scrollContainerRef.current
    if (!anchor || !container) return
    pendingZoomAnchorRef.current = null
    container.scrollLeft = scrollLeftForZoomChange(
      anchor.oldScrollLeft,
      anchor.cursorXInContainer,
      anchor.oldPpb,
      ppb
    )
    // Chromium has a known issue where position:sticky descendants (the
    // channel row's m/s/fx button stack) don't recompute their on-screen
    // offset when scrollLeft is set from JS in the same frame their
    // container's content is resizing, as opposed to a native user scroll --
    // they visibly freeze at a stale position instead of tracking the
    // container's right edge. Reading offsetHeight forces a synchronous
    // layout flush, which nudges Chromium into recomputing sticky offsets
    // immediately rather than leaving them stale until some unrelated
    // repaint happens to touch them.
    void container.offsetHeight
  }, [ppb])

  // Sets the cursor at the document level so holding Cmd shows the hand
  // immediately no matter where the mouse already happens to be sitting —
  // matches Cmd's other role as the zoom modifier (Cmd+scroll), so holding
  // it always reads as "viewport navigation" regardless of which specific
  // gesture follows.
  useEffect(() => {
    if (!handModeHeld) return
    document.body.style.cursor = panning ? 'grabbing' : 'grab'
    return () => {
      document.body.style.cursor = ''
    }
  }, [handModeHeld, panning])

  // Only starts a pan when the mousedown is Cmd-held and doesn't land on an
  // actual clip surface -- a clip's own Cmd+drag means "duplicate this
  // clip" (native HTML5 drag, handled entirely separately) and must never
  // be intercepted by this. Originally checked `e.target === e.currentTarget`,
  // but that was far too strict: ChannelRow's own row wrapper, RifffBlockRow's
  // own wrapper, and the ghost rows all sit between the timeline's background
  // div and empty (non-clip) space within a channel row, so almost every
  // mousedown on genuinely empty space had some intervening div as its
  // target and silently failed this check -- panning only ever worked when
  // clicking pixels with literally nothing rendered between them and
  // Timeline's own div. The `[data-rifff-clip]` marker (on RifffBlockRow's
  // name bar and the actual clip-body surface in StemWaveformRow/
  // CollapsedRifffRow) is what those components render pixels for; anything
  // else bubbling up here is background, panned regardless of which
  // wrapper div happens to sit in between.
  // Pans freely in both directions -- unlike the wheel-driven zoom gesture
  // above, which axis-locks to decide zoom-vs-pan, a Cmd+drag is
  // unambiguously "pan" already (that's the whole gesture), so there's
  // nothing to axis-lock here; only the wheel case needs isVerticalDominant.
  function handlePanMouseDown(e: MouseEvent<HTMLDivElement>): void {
    if (!e.metaKey) return
    if ((e.target as HTMLElement).closest('[data-rifff-clip]')) return
    const container = scrollContainerRef.current
    if (!container) return
    const startScrollLeft = container.scrollLeft
    const startScrollTop = container.scrollTop
    setPanning(true)
    startPointerDrag(
      e,
      (deltaX, deltaY) => {
        container.scrollLeft = startScrollLeft - deltaX
        container.scrollTop = startScrollTop - deltaY
      },
      () => setPanning(false)
    )
  }

  return (
    <div className="ra-viewport">
      <StartupGate />
      <OwnUsernameReporter />
      <SketchModeAutoFollow onSoundingChange={setSketchSoundingId} />
      <BackgroundFeatureScan />
      {/* The one app-wide "what is running in the background" line --
       * analysis scans, library index, auto-classify, plugin scan, sync
       * (see its own doc comment). Replaces LibraryWarmupIndicator and
       * DiscoverLibraryScan's own progress line. */}
      <BackgroundWorkIndicator />
      {/* One column, so a notice that wraps pushes the next down (TopRightNotices). */}
      <TopRightNotices>
        <EngineStartupIndicator />
        <StemsUnavailableIndicator />
        <PluginsOffNotice />
        <PluginsHeldNotice />
        <ReonedCopyMissingNotice />
        <ReonedCopiesNotice />
        <ReoneNotice />
        <SaveCopyNotice />
      </TopRightNotices>
      {/* Mounted here (not inside DiscoverPanel.tsx), same top-level,
       * mount-once-per-app-session pattern as BackgroundFeatureScan just
       * above, and gated on the same `discoverConsented` state the
       * settings-menu toggle and DiscoverPanel's own consent prompt both
       * now share -- see DiscoverLibraryScan.tsx's own doc comment for
       * the full "why" (fixes the scan restarting on every Discover tab
       * switch). It also runs the YAMNet zero-shot step for stems embedded
       * before that step existed (background efficiency B5 -- formerly a
       * separate YamnetZeroShotRetroactiveScan). */}
      {discoverConsented && <DiscoverLibraryScan />}
      <div className="ra-frame">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid var(--ra-border-soft)'
          }}
        >
          <div style={{ flex: 1 }}>
            <Titlebar
              sketchName={
                currentSketch === null
                  ? 'untitled'
                  : currentSketch.kind === 'library'
                    ? currentSketch.name
                    : basenameWithoutProjectExt(currentSketch.path)
              }
              rifffCount={Object.keys(state.rifffs).length}
              stemCount={Object.values(state.rifffs).reduce((n, r) => n + r.stems.length, 0)}
              onRename={(newName) => void handleRename(newName)}
              renameError={renameError}
              dirty={dirty}
              mode={state.mode}
              sketchEligible={isSketchEligible(state)}
              onCycleMode={handleCycleArrangerMode}
            />
          </div>
          <div style={{ paddingRight: 14 }}>
            <ProjectMenu
              currentSketch={currentSketch}
              setCurrentSketch={setCurrentSketch}
              handleNew={handleNew}
              handleSave={handleSave}
              serializeForSave={() => serializeForSave()}
              markSaved={(touchedVersion) => recordSaved(state, touchedVersion)}
              onOpenLibrary={openLibraryBrowser}
              onOpenClusterStems={() => openClusterStems('sketch')}
              onOpenClusterStemsLibrary={() => openClusterStems('library')}
              onOpenAutoArrange={() => setAutoArrangeOpen(true)}
              onOpenDrawArrange={() => setDrawArrangeOpen(true)}
            />
          </div>
        </div>
        {/* Kept above the mode-specific Arrange / Map / Sketch content so
            two-riff Shelf selection and Cross are available in all three. */}
        <Shelf
          sketchSoundingId={sketchSoundingId}
          onImported={handleImported}
          onOpenLibrary={openRiffLibrary}
          onSeedDiscover={openRiffLibraryWithDiscoverSeed}
          selectedRiffIds={selectedRiffIds}
          selectionAnchorId={riffSelectionAnchorId}
          onSelectionChange={handleRiffSelectionChange}
          onBeforePreview={() => shapePreviewStopRef.current?.()}
          hoveredRiffKey={hoveredRiffKey}
          onRiffHover={setHoveredRiffKey}
        />
        {shapeOpen && shapeDraft?.projectKey === shapeProjectKey(projectSessionEpochRef.current) ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            <ShapePanel
              draft={shapeDraft}
              setDraft={setShapeDraft}
              processRack={shapeProcessRacks[shapeDraft.projectKey] ?? []}
              onProcessRackChange={(rack) =>
                setShapeProcessRacks((current) => ({
                  ...current,
                  [shapeDraft.projectKey]: rack
                }))
              }
              onPreviewStopReady={(stop) => {
                shapePreviewStopRef.current = stop
              }}
              active={
                !riffLibraryOpen &&
                !crossOpen &&
                !shapeDiscardPromptOpen &&
                !departureSaveBusy &&
                !projectDepartureLocked &&
                !unsavedChangesPromptOpen &&
                newProjectModal === null &&
                !libraryBrowserOpen
              }
              onKeep={async (draft) => {
                const label = await publishShape(draft, 'keep')
                if (!label) throw new Error('the draft changed before keep finished.')
                return label
              }}
              onAddToShelf={async (draft) => {
                await publishShape(draft, 'shelf')
              }}
              onAddToTimeline={async (draft) => {
                await publishShape(draft, 'timeline')
              }}
              initialSourceLean={radioSourceOf(discoverSettingsRef.current.radio)}
              onSourceLeanCommit={(source) => void setRadioSettings({ source })}
              onClose={closeShape}
            />
          </div>
        ) : (
          <>
            <TransportBar
              onEnableGatedRecording={() => void enableGatedRecording()}
              onDisableGatedRecording={() => void disableGatedRecording()}
              onStop={() => void handleStop()}
              onShowWelcome={showWelcomeAgain}
              onOpenEndlesss={() => openRiffLibrary('import')}
              onStartTour={replayTour}
              discoverConsented={discoverConsented}
              toggleDiscoverConsent={toggleDiscoverConsent}
              traitMatchBar={traitMatchBar}
              cycleTraitMatchBar={cycleTraitMatchBar}
            />
            {/* flex:1 (down the column .ra-frame now is) + minHeight:0 makes this
          row consume all the vertical space left after the header/Shelf/
          TransportBar rows above take their own natural heights — the row's
          own children then stretch to fill THAT (flex row's default
          align-items:stretch), which is what pins the scroll container's
          horizontal scrollbar to the bottom of the visible frame regardless
          of how many rows are actually placed, instead of it sitting right
          after however much content happens to exist. */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
              {/* minWidth:0 lets this flex item shrink below its content's intrinsic
            width, which is what allows overflow-x:auto to actually kick in
            instead of the row silently stretching .ra-frame's fixed width. */}
              <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                <div
                  ref={scrollContainerRef}
                  // Where sssketchy stands for the whole of phase two (see
                  // coachSteps.ts's TIMELINE), and what makes him WALK out of
                  // Discover when phase one ends: the anchor selector changes,
                  // useAnchorLeft measures a different left, and the walk plays.
                  data-coach-anchor="timeline"
                  onWheel={handleTimelineWheel}
                  style={{ height: '100%', overflowX: 'auto', overflowY: 'auto' }}
                >
                  {/* One arrangement, two zoom levels (spec, "The map"). The
                  coach anchor stays on the scroll container rather than on
                  either child, so sssketchy does not jump across the screen
                  when the view flips. */}
                  {state.mode === 'map' ? (
                    // The map's own "what is this?" keeps the SKETCH population --
                    // it is asking about the rows on THIS map.
                    <ArrangementMap onWhatIsThis={() => openClusterStems('sketch')} />
                  ) : (
                    <Timeline
                      onOpenClipMenu={openClipMenu}
                      onOpenRiserMenu={openRiserMenu}
                      onOpenPasteMenu={openPasteMenu}
                      onBackgroundMouseDown={handlePanMouseDown}
                      riserArm={riserArm}
                      onCancelRiserArm={cancelRiserArm}
                      onCreateRiser={createRiserFromGesture}
                      openRiserLaneId={openRiserLaneId}
                      onCloseRiserLane={closeRiserLane}
                      selectedRiffIds={selectedRiffIds}
                      riffSelectionAnchorId={riffSelectionAnchorId}
                      onRiffSelectionChange={handleRiffSelectionChange}
                      hoveredRiffKey={hoveredRiffKey}
                      onRiffHover={setHoveredRiffKey}
                    />
                  )}
                </div>
                {state.mode === 'normal' && (
                  // The mixer rail: the column every row's m/s/fx and gain
                  // controls are pinned into (MixerRailAnchor), docked at the
                  // viewport's right edge beside the inspector. It's drawn here,
                  // outside the scroller, so it never scrolls; the controls
                  // themselves live in their rows (so they line up with them
                  // vertically) and sit above this at zIndex 5/6. It sits just
                  // left of the scroller's own scrollbars, where the sticky
                  // controls land, rather than over them.
                  //
                  // It takes the pointer, so a click in a gap between controls
                  // doesn't scrub or grab a clip hidden underneath. Being
                  // outside the scroller, it hands wheel gestures back to it.
                  <div
                    onWheel={(e) => {
                      const gesture = railWheelGesture(e)
                      if (gesture.kind === 'zoom') handleTimelineWheel(e)
                      else
                        scrollContainerRef.current?.scrollBy({
                          left: gesture.left,
                          top: gesture.top
                        })
                    }}
                    style={{
                      position: 'absolute',
                      zIndex: 4,
                      top: 0,
                      right: scrollbarInsets.right,
                      bottom: scrollbarInsets.bottom,
                      width: ARRANGEMENT_MIXER_RAIL_WIDTH,
                      boxSizing: 'border-box',
                      borderLeft: '1px solid var(--ra-border)',
                      background: 'var(--ra-bg-bar)'
                    }}
                  />
                )}
                {state.mode === 'normal' && (
                  // The rail's heading, over the ruler's right end (the ruler is
                  // zIndex 10, above the rail itself).
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      zIndex: 11,
                      top: 0,
                      right: scrollbarInsets.right,
                      width: ARRANGEMENT_MIXER_RAIL_WIDTH,
                      height: 24,
                      boxSizing: 'border-box',
                      display: 'grid',
                      placeItems: 'center',
                      borderLeft: '1px solid var(--ra-border)',
                      borderBottom: '1px solid var(--ra-border)',
                      background: 'var(--ra-bg-bar)',
                      color: 'var(--ra-text-4)',
                      fontSize: 8,
                      pointerEvents: 'none'
                    }}
                  >
                    mix
                  </div>
                )}
              </div>
              {/* Drawer handle — same subtle-strip visual language as the stem
            resize handles (StemWaveformRow/CollapsedRifffRow), just click
            instead of drag. Always present, on either side of the drawer, so
            there's a consistent single place to grab regardless of the
            Inspector's current state. */}
              <button
                onClick={() => dispatch({ type: 'TOGGLE_INSPECTOR_COLLAPSED' })}
                aria-label="toggle inspector panel"
                title={state.inspectorCollapsed ? 'show inspector' : 'hide inspector'}
                style={{
                  flex: 'none',
                  width: 10,
                  border: 'none',
                  borderLeft: '1px solid var(--ra-border)',
                  background: 'var(--ra-text)',
                  opacity: 0.12,
                  cursor: 'pointer'
                }}
              />
              {/* Inspector itself stays a fixed 308px wide (its own inner layout
            doesn't reflow during the slide) — this wrapper is what actually
            animates, clipping it via overflow:hidden rather than
            mounting/unmounting, so collapsing/expanding reads as a drawer
            sliding shut rather than a hard cut. */}
              <div
                style={{
                  width: state.inspectorCollapsed ? 0 : 308,
                  flex: 'none',
                  // overflowX stays hidden for the slide animation (clips the
                  // fixed-width Inspector while this wrapper's own width
                  // transitions); overflowY is now 'auto' rather than hidden too
                  // — the frame no longer grows to fit tall content (see
                  // .ra-frame's own bounded height), so without this, Inspector
                  // content past the available height would just be invisibly
                  // clipped instead of scrollable.
                  overflowX: 'hidden',
                  overflowY: 'auto',
                  transition: 'width 150ms ease'
                }}
              >
                <Inspector
                  onOpenBeatPicker={handleOpenBeatPickerForEdit}
                  onSeedDiscover={openRiffLibraryWithDiscoverSeed}
                  crossPair={inspectorCrossPair}
                  onCrossRiffs={(rifffs) => void openCrossFromRiffs(rifffs)}
                  editRifff={inspectorEditRifff}
                  onEditRifff={(rifff) => void openShapeFromRifff(rifff)}
                />
              </div>
            </div>
          </>
        )}
        {pickerGroupId && state.rifffs[pickerGroupId] && (
          <BeatPicker
            groupId={pickerGroupId}
            isNewImport={pickerIsNewImport}
            batchGroupIds={pickerBatchGroupIds.length > 1 ? pickerBatchGroupIds : undefined}
            onNavigate={setPickerGroupId}
            onClose={() => {
              // A batch import means "I picked everything I wanted, now let's
              // arrange" — close the library along with the picker so it
              // doesn't linger in the way. A single import means "I'm
              // browsing one at a time" — leave the library open (it never
              // auto-closes on its own) so the next pick is right there.
              const wasBatchImport = pickerBatchGroupIds.length > 1
              setPickerGroupId(null)
              setPickerBatchGroupIds([])
              if (wasBatchImport) setRiffLibraryOpen(false)
            }}
            onBaked={(steps) => {
              const siblings = pickerBatchGroupIds
                .filter((id) => id !== pickerGroupId)
                .flatMap((id) => (state.rifffs[id] ? [state.rifffs[id]] : []))
              if (siblings.length === 0) return
              const batchSize = pickerBatchGroupIds.length
              const snapDiv = SNAP_DIVS[state.snapIdx]
              // Each sibling is its own all-or-nothing bake; one that fails stays wholly at its
              // original phase, so it is named rather than left to a console line.
              void reoneSiblings(siblings, (sibling) =>
                bakeStems(dispatch, steps, snapDiv, sibling.stems, [sibling.groupId])
              ).then((failed) => {
                if (failed.length > 0) showReoneNotice(siblingsNotReonedText(failed, batchSize))
              })
            }}
          />
        )}
        {riffLibraryOpen && (
          <LibraryBrowser
            onClose={() => setRiffLibraryOpen(false)}
            onImported={handleLibraryImported}
            currentSketch={currentSketch}
            discoverConsented={discoverConsented}
            traitMatchBar={traitMatchBar}
            radioSettings={radioSettings}
            onRadioSettingsChange={setRadioSettings}
            radioView={radioView}
            onRadioViewChange={setRadioView}
            setDiscoverConsented={setDiscoverConsented}
            discoverSlots={discoverSlots}
            setDiscoverSlots={setDiscoverSlots}
            discoverArtists={discoverArtists}
            setDiscoverArtists={setDiscoverArtists}
            discoverChaos={discoverChaos}
            setDiscoverChaos={setDiscoverChaos}
            discoverUndoStack={discoverUndoStack}
            setDiscoverUndoStack={setDiscoverUndoStack}
            discoverRedoStack={discoverRedoStack}
            setDiscoverRedoStack={setDiscoverRedoStack}
            discoverSeedBpm={discoverSeedBpm}
            setDiscoverSeedBpm={setDiscoverSeedBpm}
            discoverSeedPhase={activeDiscoverSeedPhase}
            setDiscoverSeedPhase={setDiscoverSeedPhase}
            initialMode={riffLibraryInitialMode}
            onCoachSlotsChange={handleCoachSlotsChange}
            onPublishedToShelf={selectPublishedShelfRiff}
          />
        )}
        {crossOpen &&
          crossDraft?.projectKey === crossProjectKey(currentSketch, state.projectSeed) && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 'var(--ra-z-fullscreen)',
                display: 'flex',
                background: 'var(--ra-bg-page)'
              }}
            >
              <CrossPanel
                draft={crossDraft}
                setDraft={setCrossDraft}
                currentProjectKey={crossProjectKey(currentSketch, state.projectSeed)}
                onSourceLeanCommit={(source) => void setRadioSettings({ source })}
                onPublishedToShelf={selectPublishedShelfRiff}
                onBack={() => {
                  setCrossOpen(false)
                  setCrossDraft(null)
                }}
              />
            </div>
          )}
        {libraryBrowserOpen && (
          <ProjectLibraryBrowser
            onClose={() => setLibraryBrowserOpen(false)}
            currentLibraryName={
              currentSketch !== null && currentSketch.kind === 'library' ? currentSketch.name : null
            }
            onBeforeReplaceProject={async () => {
              beginProjectDeparture()
              const choice = await confirmDiscardIfDirty()
              if (choice === 'cancel') {
                endProjectDeparture()
                return 'cancel'
              }
              if (choice === 'save') {
                const saved = await saveBeforeLeaving()
                // Save failed (saveBeforeLeaving already alerted) -- abort the
                // open/restore rather than replacing the still-unsaved
                // live project.
                if (!saved) {
                  endProjectDeparture()
                  return 'cancel'
                }
              } else {
                // 'discard' -- see handleNew's matching comment above.
                clearAutosaveNow()
              }
              if (!projectDepartureIsCurrent()) {
                endProjectDeparture()
                return 'cancel'
              }
              return 'proceed'
            }}
            onSelect={(name) => {
              void (async () => {
                setBusy('opening project…')
                try {
                  if (!projectDepartureIsCurrent()) return
                  const result = await window.rifffApi.openLibrarySketch(name)
                  if (!result) return
                  const { state: loaded, pluginStates } = deserializeProject(
                    JSON.parse(result.json),
                    await appSoundDefaults()
                  )
                  setBusy('loading…')
                  const opened = await openWithReonedRepair(loaded)
                  await warmStemCaches(opened.state)
                  if (!projectDepartureIsCurrent()) {
                    reonedOpenFailed()
                    return
                  }
                  invalidateShapeSession()
                  projectSessionEpochRef.current = crypto.randomUUID()
                  restoreState(opened.state, pluginStates)
                  lastSavedJsonRef.current = opened.savedJson
                  setCurrentSketch({ kind: 'library', name })
                } catch (err) {
                  console.error('App: failed to open library sketch:', err)
                  reonedOpenFailed()
                } finally {
                  endProjectDeparture()
                  setBusy(null)
                }
              })()
            }}
            onOpenFromDisk={() => {
              void (async () => {
                beginProjectDeparture()
                const choice = await confirmDiscardIfDirty()
                if (choice === 'cancel') {
                  endProjectDeparture()
                  return
                }
                if (choice === 'save') {
                  const saved = await saveBeforeLeaving()
                  // Save failed (saveBeforeLeaving already alerted) -- bail out
                  // rather than proceeding to the disk-open flow, which
                  // would replace the still-unsaved live project.
                  if (!saved) {
                    endProjectDeparture()
                    return
                  }
                } else {
                  // 'discard' -- see handleNew's matching comment above.
                  clearAutosaveNow()
                }
                setLibraryBrowserOpen(false)
                setBusy('opening project…')
                try {
                  const result = await window.rifffApi.openProject()
                  if (!result) return
                  const { state: loaded, pluginStates } = deserializeProject(
                    JSON.parse(result.json),
                    await appSoundDefaults()
                  )
                  // Same pre-warm-before-LOAD_STATE reasoning as the onSelect
                  // handler right above -- see its own comment history.
                  setBusy('loading…')
                  const opened = await openWithReonedRepair(loaded)
                  await warmStemCaches(opened.state)
                  if (!projectDepartureIsCurrent()) {
                    reonedOpenFailed()
                    return
                  }
                  invalidateShapeSession()
                  projectSessionEpochRef.current = crypto.randomUUID()
                  restoreState(opened.state, pluginStates)
                  lastSavedJsonRef.current = opened.savedJson
                  setCurrentSketch({ kind: 'external', path: result.path })
                } catch (err) {
                  console.error('App: failed to open project from disk:', err)
                  reonedOpenFailed()
                } finally {
                  endProjectDeparture()
                  setBusy(null)
                }
              })()
            }}
          />
        )}
        {clusterStemsOpen && (
          <ClusterStemsBrowser
            onClose={() => setClusterStemsOpen(false)}
            currentSketch={currentSketch}
            population={clusterStemsPopulation}
          />
        )}
        {autoArrangeOpen && (
          <AutoArrangeWizard
            onClose={() => setAutoArrangeOpen(false)}
            currentSketch={currentSketch}
          />
        )}
        {drawArrangeOpen && (
          <DrawArrangeWizard
            onClose={() => setDrawArrangeOpen(false)}
            currentSketch={currentSketch}
          />
        )}
        {newProjectModal && (
          <NewProjectModal
            defaultName={newProjectModal.defaultName}
            defaultBpm={loadLastProjectTempo(initialState.bpm)}
            onCreate={commitNewProject}
            onCancel={() => {
              setNewProjectModal(null)
              endProjectDeparture()
            }}
          />
        )}
        {unsavedChangesPromptOpen && (
          <UnsavedChangesDialog
            hasShapeChanges={shapeDirty}
            onSave={() => resolveUnsavedChangesPrompt('save')}
            onDiscard={() => resolveUnsavedChangesPrompt('discard')}
            onCancel={() => resolveUnsavedChangesPrompt('cancel')}
          />
        )}
        {shapeDiscardPromptOpen && (
          <ConfirmationDialog
            message="discard your EEEDIT changes?"
            detail="anything not kept or added to the shelf is lost."
            actions={[
              { label: 'cancel', onClick: () => setShapeDiscardPromptOpen(false) },
              { label: 'discard', onClick: finishCloseShape, danger: true, primary: true }
            ]}
          />
        )}
        <LockInConfirmDialog />
        <UpdateAvailableDialog />
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}
        {showLibraryLocationSetup && (
          <LibraryLocationModal
            libraryRoot={libraryRootForSetup}
            onChooseFolder={() => void handleChooseLibraryFolderAtSetup()}
            onContinue={dismissLibraryLocationSetup}
          />
        )}
        {/* Shown whenever the normal welcome opt-out says so, OR
          (unconditionally, overriding that opt-out) whenever there's a
          genuine crash-recovery snapshot to offer -- see
          recoverableAutosave's own doc comment. Surfacing an unresolved
          crash-recovery snapshot always wins over "don't show this again,"
          since that opt-out was about the welcome pitch, not about
          silently dropping recoverable work. */}
        {!showLibraryLocationSetup &&
          !onboardingDismissedForSession &&
          (showOnboarding || recoverableAutosave !== null || recoverablePrevious !== null) && (
            <OnboardingModal
              hasRecovery={recoverableAutosave !== null}
              onRecover={(dontShowAgain) => void handleRecoverAutosave(dontShowAgain)}
              onDiscardRecovery={handleDiscardRecovery}
              hasPreviousRecovery={recoverablePrevious !== null}
              onRecoverPrevious={(dontShowAgain) => void handleRecoverPrevious(dontShowAgain)}
              onDiscardPreviousRecovery={handleDiscardPreviousRecovery}
              onNewProject={(dontShowAgain) => {
                // Dismiss first so the welcome modal doesn't visually stack
                // behind/conflict with whatever handleNew() shows next (the
                // discard-guard dialog and/or NewProjectModal) -- see
                // handleNew()'s own doc comment for why this routes through
                // the exact same path as the toolbar's "new" button rather
                // than a separate welcome-only shortcut.
                dismissOnboarding(dontShowAgain)
                void handleNew()
              }}
              onOpenProject={(dontShowAgain) => {
                dismissOnboarding(dontShowAgain)
                openLibraryBrowser()
              }}
              onOpenEndlesss={(dontShowAgain) => {
                dismissOnboarding(dontShowAgain)
                openRiffLibrary('import')
              }}
              onStartTour={(dontShowAgain) => {
                const hasExistingContent = Object.keys(state.rifffs).length > 0
                if (
                  hasExistingContent &&
                  !window.confirm('start the tour? this adds a demo rifff to your current sketch.')
                ) {
                  return
                }
                dismissOnboarding(dontShowAgain)
                void startTour()
              }}
              onDismiss={hideOnboardingForSession}
              tourSeen={tourSeen}
              endlesssLoggedIn={endlesssLoggedIn}
            />
          )}
        {tourStepIndex !== null && (
          <TourOverlay
            steps={TOUR_STEPS}
            stepIndex={tourStepIndex}
            onNext={() => {
              if (tourStepIndex >= TOUR_STEPS.length - 1) {
                endTour()
                return
              }
              setTourStepIndex(tourStepIndex + 1)
            }}
            onBack={() => setTourStepIndex(Math.max(0, tourStepIndex - 1))}
            onSkip={endTour}
          />
        )}
        {/* Renders nothing at all unless a flow has been started from the
            auto-arranger's "walk me through it" route -- see SssketchyCoach's own
            doc comment. Mounted here, at the frame's top level, rather than
            inside any one panel, because a step's anchor can be anywhere in
            the app (Discover, the timeline, the auto-arranger). */}
        <SssketchyCoach
          discoverSlots={coachSlots}
          riffLibraryOpen={riffLibraryOpen}
          onMove={handleCoachMove}
        />
      </div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <StoreProvider>
      <BusyProvider>
        <Frame />
        <BusyOverlay />
      </BusyProvider>
    </StoreProvider>
  )
}
