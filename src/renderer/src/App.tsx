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
  useAppSelector,
  useAppState,
  useDispatch,
  useHistory,
  usePlaying,
  usePos,
  useZoom
} from './state/StoreContext'
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
import { ChannelRow } from './components/ChannelRow'
import { SketchStrip } from './components/SketchStrip'
import { Playhead } from './components/Playhead'
import { BeatPicker, bakeStems, rebakeRifff } from './components/BeatPicker'
import { LibraryBrowser } from './components/LibraryBrowser'
import { ProjectLibraryBrowser } from './components/ProjectLibraryBrowser'
import { ClusterStemsBrowser } from './components/ClusterStemsBrowser'
import { LockInConfirmDialog } from './components/LockInConfirmDialog'
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu'
import { BusyOverlay } from './components/BusyOverlay'
import { NewProjectModal } from './components/NewProjectModal'
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog'
import { TidyUpNudgeModal } from './components/TidyUpNudgeModal'
import { ExportFormatPicker } from './components/ExportFormatPicker'
import { StemsFormatPicker } from './components/StemsFormatPicker'
import { OnboardingModal } from './components/OnboardingModal'
import { LibraryLocationModal } from './components/LibraryLocationModal'
import { TourOverlay, type TourStep } from './components/TourOverlay'
import { BusyProvider, useBusy } from './state/BusyContext'
import { serializeProject, deserializeProject } from './state/serialize'
import { hasUnsavedChanges } from './state/unsavedChanges'
import { warmStemCaches } from './audio/warmStemCaches'
import { markManualSeek } from './state/manualSeek'
import { useGatedRecordingControls } from './state/useGatedRecordingControls'
import {
  loopLengthBars,
  pasteRifffAction,
  channelsInOrder,
  nextArrangerMode,
  isSketchEligible,
  groupIdAtPosition
} from './state/selectors'
import { initialState, SNAP_DIVS } from './state/store'
import type { LoopRegion } from './state/store'
import { applyGrabOffset, getGrabOffsetBars } from './components/dragGrabOffset'
import { startPointerDrag } from './components/dragUtils'
import { useHandModeHeld } from './components/useHandModeHeld'
import type { Rifff } from '@shared/types'
import { pickBestRifffForReOne } from '@shared/reOneScoring'

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
  onOpenPasteMenu,
  onBackgroundMouseDown
}: {
  onOpenClipMenu: (x: number, y: number, groupId: string) => void
  onOpenPasteMenu: (x: number, y: number, bar: number) => void
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
        // becomes its own independent one-shot. Sharing targetChannelId (if
        // any) means several files dropped together on an existing
        // ChannelRow all land on that same channel; dropping on empty/ghost
        // space instead calls crypto.randomUUID() fresh per file, giving
        // each its own new channel -- same rule already used for a single
        // internal-drag drop above, just applied per file. See
        // docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md.
        const files = Array.from(e.dataTransfer.files)
        if (files.length === 0) return
        for (const file of files) {
          const path = window.rifffApi.getPathForFile(file)
          const rifff = await window.rifffApi.importOneShot(path)
          if (!rifff) continue
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
    // Only reached for empty timeline space — RifffBlockRow's clip stops
    // propagation before this bubbles up, so a right-click on an actual clip
    // never also triggers the paste menu.
    e.preventDefault()
    onOpenPasteMenu(e.clientX, e.clientY, barForClientX(e.clientX, e.currentTarget, ppb))
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
    return <SketchStrip />
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
  // every child the correct wide containing block, so sticky tracks the
  // real viewport edge exactly like Ruler's own horizontal scroll already
  // does correctly.
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
          onDropOnChannel={handleDropOnChannel}
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

function ProjectMenu({
  currentSketch,
  setCurrentSketch,
  handleNew,
  handleSave,
  onOpenLibrary,
  onOpenClusterStems
}: {
  currentSketch: CurrentSketch
  setCurrentSketch: (sketch: CurrentSketch) => void
  /** Owned by App.tsx's Frame -- the only place that knows every "this
   * content is now durably saved" moment (initial load/recovery, explicit
   * Save/Cmd+S, the quit-time save prompt) and the only place that can run
   * the shared discard-guard (Frame also owns confirmDiscardIfDirty).
   * ProjectMenu itself is purely presentational for these two. */
  handleNew: () => Promise<void>
  handleSave: () => Promise<void>
  onOpenLibrary: () => void
  /** Opens the "tidy up" browser -- the same callback TransportBar.tsx's
   * own tidy-up button already uses (wired to setClusterStemsOpen(true) in
   * App.tsx's Frame). Reused here for the export-time nudge's "tidy up
   * first" button. */
  onOpenClusterStems: () => void
}): React.JSX.Element {
  const state = useAppState()
  const [exporting, setExporting] = useState(false)
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const [saveMenu, setSaveMenu] = useState<{ x: number; y: number } | null>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const [tidyUpNudgeOpen, setTidyUpNudgeOpen] = useState(false)
  const [pendingExportFormat, setPendingExportFormat] = useState<ExportFormat | null>(null)
  const [exportFormatPickerOpen, setExportFormatPickerOpen] = useState(false)
  const [stemsFormatPickerOpen, setStemsFormatPickerOpen] = useState(false)

  async function handleSaveCopyElsewhere(): Promise<void> {
    try {
      await window.rifffApi.saveProject(serializeProject(state))
    } catch (err) {
      console.error('ProjectMenu: failed to save a copy elsewhere:', err)
    }
  }

  async function handleDuplicateAsNewVersion(): Promise<void> {
    if (currentSketch === null || currentSketch.kind !== 'library') return
    try {
      // Save current edits first, so the duplicate reflects them.
      await window.rifffApi.saveProjectToLibrary(currentSketch.name, serializeProject(state))
      const result = await window.rifffApi.duplicateSketch(currentSketch.name)
      if (!result) return
      setCurrentSketch({ kind: 'library', name: result.name })
    } catch (err) {
      console.error('ProjectMenu: failed to duplicate sketch as a new version:', err)
      window.alert(`Duplicate failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleExportMix(): Promise<void> {
    setExporting(true)
    try {
      const wav = await window.rifffApi.exportMixNative(JSON.stringify(state))
      await window.rifffApi.exportMix(wav)
    } catch (err) {
      console.error('ProjectMenu: failed to export mix:', err)
      // Export now has exactly one code path (the native engine, with no Web
      // Audio fallback) — a spawn/render failure here would otherwise reset
      // the button with zero visible indication anything went wrong.
      window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  async function runExportProject(format: ExportFormat): Promise<void> {
    setExporting(true)
    try {
      if (currentSketch !== null && currentSketch.kind === 'library') {
        if (format === 'ableton') {
          const warn = await window.rifffApi.shouldWarnBeforeAbletonOverwrite(currentSketch.name)
          if (
            warn &&
            !window.confirm(
              "This sketch's Ableton export has been modified since the last export from sssketch (likely from mixing directly in Ableton). Exporting again will overwrite it. Continue?"
            )
          ) {
            return
          }
          await window.rifffApi.exportAlsToLibrary(JSON.stringify(state), currentSketch.name)
        } else if (format === 'reaper') {
          await window.rifffApi.exportRppToLibrary(JSON.stringify(state), currentSketch.name)
        } else if (format === 'stemTracks') {
          await window.rifffApi.exportStemTracksToLibrary(JSON.stringify(state), currentSketch.name)
        } else {
          await window.rifffApi.exportStemsToLibrary(JSON.stringify(state), currentSketch.name)
        }
      } else if (currentSketch !== null && currentSketch.kind === 'external') {
        if (format === 'ableton') {
          await window.rifffApi.exportAlsNextToSource(JSON.stringify(state), currentSketch.path)
        } else if (format === 'reaper') {
          await window.rifffApi.exportRppNextToSource(JSON.stringify(state), currentSketch.path)
        } else if (format === 'stemTracks') {
          await window.rifffApi.exportStemTracksNextToSource(
            JSON.stringify(state),
            currentSketch.path
          )
        } else {
          await window.rifffApi.exportStemsNextToSource(JSON.stringify(state), currentSketch.path)
        }
      } else {
        // currentSketch === null: nothing saved yet, no real location to
        // export next to -- Ableton/Reaper fall back to a save dialog
        // (same as before); both stems variants already have their own
        // dialog-based folder picker as their fallback.
        if (format === 'ableton') {
          const defaultName = await window.rifffApi.generateDefaultProjectName()
          await window.rifffApi.exportAls(JSON.stringify(state), defaultName)
        } else if (format === 'reaper') {
          const defaultName = await window.rifffApi.generateDefaultProjectName()
          await window.rifffApi.exportRpp(JSON.stringify(state), defaultName)
        } else if (format === 'stemTracks') {
          // exportStemTracksNative's filenames embed the project name
          // directly, unlike exportAls/exportRpp's optional save-dialog
          // suggestion -- so it's always generated here, not optional.
          const defaultName = await window.rifffApi.generateDefaultProjectName()
          await window.rifffApi.exportStemTracksNative(JSON.stringify(state), defaultName)
        } else {
          await window.rifffApi.exportStemsNative(JSON.stringify(state))
        }
      }
    } catch (err) {
      console.error(`ProjectMenu: failed to export (${format}):`, err)
      window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  function handleExportProject(format: ExportFormat): void {
    if (Object.keys(state.busOf).length === 0) {
      setPendingExportFormat(format)
      setTidyUpNudgeOpen(true)
      return
    }
    void runExportProject(format)
  }

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
      <button
        ref={saveButtonRef}
        onClick={(e) => {
          // Toggles closed if already open -- see ContextMenu's own
          // ignoreRef doc comment (and TransportBar.tsx's gear-menu button)
          // for why the trigger also needs to be passed there.
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
            { label: 'save a copy elsewhere…', onClick: handleSaveCopyElsewhere },
            ...(currentSketch !== null && currentSketch.kind === 'library'
              ? [{ label: 'save a copy', onClick: handleDuplicateAsNewVersion }]
              : [])
          ]}
          onClose={() => setSaveMenu(null)}
        />
      )}
      <button onClick={onOpenLibrary} style={buttonStyle}>
        open
      </button>
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
          onChoose={(format) => {
            setExportFormatPickerOpen(false)
            handleExportProject(format)
          }}
          onCancel={() => setExportFormatPickerOpen(false)}
        />
      )}
      {stemsFormatPickerOpen && (
        <StemsFormatPicker
          onChoose={(format) => {
            setStemsFormatPickerOpen(false)
            handleExportProject(format)
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
            if (pendingExportFormat) void runExportProject(pendingExportFormat)
          }}
        />
      )}
    </div>
  )
}

// How long to wait after the last real edit before writing the crash-
// recovery snapshot — frequent enough that a crash doesn't lose much work,
// infrequent enough not to hammer disk I/O. Drags in this app already
// commit as a single dispatch on release (not continuously while dragging),
// so there's no realistic "the debounce never settles" scenario to guard
// against with a separate max-interval ceiling.
const AUTOSAVE_DEBOUNCE_MS = 4000

const ONBOARDING_SEEN_STORAGE_KEY = 'sssketch:onboardingSeen'
// Separate flag from onboarding's own -- this is a real one-time setup
// decision (where do sketches live), not a recurring reminder, so it
// never shows again once dismissed, unlike the welcome modal.
const LIBRARY_LOCATION_SEEN_STORAGE_KEY = 'sssketch:libraryLocationSeen'

const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour-id="tour-import"]',
    title: 'getting audio in',
    body: 'drag a rifff folder onto the shelf, or click import to browse Endlesss directly.'
  },
  {
    selector: '[data-rifff-clip]',
    title: 'the timeline',
    body: 'drag a clip to move it, drag its edges to crop.'
  },
  {
    selector: '[data-tour-id="tour-tidy"]',
    title: 'tidy up',
    body: 'groups similar-sounding stems onto shared tracks automatically.'
  },
  {
    selector: '[data-tour-id="tour-mode"]',
    title: 'sketch / arrange',
    body: 'sketch is a quick rough layout; arrange is the basic timeline.'
  }
]

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
function SketchModeAutoFollow(): null {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const pos = usePos()
  const autoFollowedGroupIdRef = useRef<string | null>(null)
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
  const setBusy = useBusy()

  // A project should always have somewhere to record onto -- fires on
  // mount and again any time recordingChannelIds empties out (e.g.
  // "new project", or loading an old save that predates this feature).
  // Purely additive: doesn't stop a user from adding MORE recording
  // channels via the existing "+ rec" button, just guarantees there's
  // never zero. The Endlesss-style gated recording feature (see the \
  // key handler below) always targets whichever one of these channels
  // comes first in channelOrder.
  useEffect(() => {
    if (Object.keys(state.recordingChannelIds).length === 0) {
      dispatch({ type: 'ADD_RECORDING_CHANNEL', channelId: crypto.randomUUID() })
    }
  }, [state.recordingChannelIds, dispatch])

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
  const persistedJson = useMemo(() => serializeProject(state), [state])

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
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    setDirty(hasUnsavedChanges(state.rifffs, persistedJson, lastSavedJsonRef.current))
  }, [state.rifffs, persistedJson, currentSketch, saveVersion])

  async function handleRename(newName: string): Promise<void> {
    setRenameError(null)
    if (currentSketch === null) {
      try {
        const json = serializeProject(state)
        await window.rifffApi.saveProjectToLibrary(newName, json)
        setCurrentSketch({ kind: 'library', name: newName })
        lastSavedJsonRef.current = json
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

  async function handleSave(): Promise<void> {
    try {
      const json = serializeProject(state)
      if (currentSketch === null) {
        const name = await window.rifffApi.generateDefaultProjectName()
        await window.rifffApi.saveProjectToLibrary(name, json)
        setCurrentSketch({ kind: 'library', name })
      } else if (currentSketch.kind === 'library') {
        await window.rifffApi.saveProjectToLibrary(currentSketch.name, json)
      } else {
        await window.rifffApi.saveProjectInPlace(currentSketch.path, json)
      }
      lastSavedJsonRef.current = json
      setSaveVersion((v) => v + 1)
    } catch (err) {
      console.error('Frame: failed to save project:', err)
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Shared discard-guard -- called from every place about to replace the
   * live in-memory project (New, opening/restoring a different library
   * sketch, opening from disk). Resolves 'discard' immediately when there's
   * nothing real to lose; otherwise shows UnsavedChangesDialog and resolves
   * once the user picks a button. See
   * docs/superpowers/specs/2026-08-14-explicit-save-model-design.md,
   * section 4. */
  function confirmDiscardIfDirty(): Promise<'save' | 'discard' | 'cancel'> {
    if (!dirty) return Promise.resolve('discard')
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
    const choice = await confirmDiscardIfDirty()
    if (choice === 'cancel') return
    if (choice === 'save') await handleSave()
    setNewProjectModal({ defaultName: await window.rifffApi.generateDefaultProjectName() })
  }

  function commitNewProject(name: string): void {
    dispatch({ type: 'LOAD_STATE', state: initialState })
    lastSavedJsonRef.current = serializeProject(initialState)
    setCurrentSketch({ kind: 'library', name })
    setNewProjectModal(null)
  }
  // Guards the startup effect below against StrictMode's dev-only
  // double-invoke: without this, both invocations independently call
  // loadAutosave() before either gets to clearAutosave(), so a real
  // crash-recovery snapshot triggers TWO "recover unsaved work?" prompts in
  // a row for the same content -- confirmed live (clicking OK on the first
  // immediately shows a second, identical one).
  const startupResolvedRef = useRef(false)

  // Once, on mount: offer to restore a crash-recovery snapshot from a
  // previous session that never got explicitly saved (see projectFile.ts's
  // writeAutosave/loadAutosave/clearAutosave — a dedicated file, decoupled
  // from the user's own named .sssketchproj saves). Cleared either way once
  // answered, so a later launch doesn't keep asking about the same stale
  // snapshot. Also restores currentSketch from the sketch-info sidecar (see
  // writeAutosaveSketchInfo/loadAutosaveSketchInfo) -- without this, the
  // next routine Save after a recovered library sketch would silently fork
  // a brand-new library entry instead of writing back to the sketch the
  // recovered content actually came from.
  useEffect(() => {
    if (startupResolvedRef.current) return
    startupResolvedRef.current = true
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
      const hasRealContent = json !== null && Object.keys(JSON.parse(json).rifffs ?? {}).length > 0
      if (hasRealContent && window.confirm('Recover unsaved work from a previous session?')) {
        const loaded = deserializeProject(JSON.parse(json))
        // Same pre-warm-before-LOAD_STATE reasoning as the library
        // browser's onSelect/onOpenFromDisk handlers below -- avoids the
        // timeline/sketch strip rendering with blank waveforms that pop
        // in one at a time as each mounted component's own decode finishes.
        setBusy('loading…')
        await warmStemCaches(loaded)
        dispatch({ type: 'LOAD_STATE', state: loaded })
        lastSavedJsonRef.current = serializeProject(loaded)
        setBusy(null)
        const sketchJson = await window.rifffApi.loadAutosaveSketch()
        // The sketch-info sidecar can be missing/corrupted even when the
        // content autosave above recovered fine (they're written/read
        // independently -- see writeAutosaveSketchInfo/loadAutosaveSketchInfo).
        // Falling back to null here would leave real recovered content
        // showing as "untitled sketch" AND excluded from the debounced
        // autosave effect's own library-write gating below (it requires
        // currentSketch.kind === 'library'). Give it a real name instead,
        // same as the fresh-start branch further down.
        setCurrentSketch(
          sketchJson
            ? (JSON.parse(sketchJson) as CurrentSketch)
            : { kind: 'library', name: await window.rifffApi.generateDefaultProjectName() }
        )
        void window.rifffApi.clearAutosave()
        return
      }
      if (json) void window.rifffApi.clearAutosave()

      // Nothing to recover (or recovery declined) -- offer to reopen
      // whatever was last opened (see writeLastOpenedSketch, kept updated
      // by the effect below), same pattern as the library browser's own
      // onSelect/onOpenFromDisk handlers, rather than always starting a
      // brand-new sketch. Asks first (declining falls straight through to
      // the fresh-start block below) rather than silently reopening it --
      // per direct feedback, launching straight into a possibly-large old
      // project isn't always what's wanted. Same window.confirm() pattern
      // as the crash-recovery prompt just above, for the same "startup
      // decision, not worth a custom modal" reasoning.
      const lastOpenedJson = await window.rifffApi.loadLastOpenedSketch()
      const lastOpened = lastOpenedJson ? (JSON.parse(lastOpenedJson) as CurrentSketch) : null
      const lastOpenedLabel =
        lastOpened?.kind === 'library'
          ? lastOpened.name
          : lastOpened
            ? basenameWithoutProjectExt(lastOpened.path)
            : null
      if (lastOpened && window.confirm(`Open the last project, "${lastOpenedLabel}"?`)) {
        const result =
          lastOpened.kind === 'library'
            ? await window.rifffApi.openLibrarySketch(lastOpened.name)
            : await window.rifffApi.openProjectFromPath(lastOpened.path)
        if (result) {
          const loaded = deserializeProject(JSON.parse(result.json))
          setBusy('loading…')
          await warmStemCaches(loaded)
          dispatch({ type: 'LOAD_STATE', state: loaded })
          lastSavedJsonRef.current = serializeProject(loaded)
          setBusy(null)
          setCurrentSketch(lastOpened)
          return
        }
        // The pointed-at sketch is gone (deleted/moved/renamed since it was
        // last opened) -- fall through to the fresh-sketch path below
        // rather than getting stuck unable to start at all.
      }

      // Fresh start (nothing to recover, no last-opened sketch, or it's
      // gone) -- give the sketch a real library name immediately rather
      // than leaving it null/"untitled sketch" until an explicit Save, so
      // there's already a real library entry name for handleSave to write
      // to (or for a duplicate/rename to target) once the user actually
      // saves, instead of handleSave having to invent one on the spot.
      lastSavedJsonRef.current = serializeProject(initialState)
      setCurrentSketch({
        kind: 'library',
        name: await window.rifffApi.generateDefaultProjectName()
      })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run-once-on-mount; dispatch/setBusy/setCurrentSketch are stable
  }, [])

  // Keeps the last-opened-sketch pointer (see writeLastOpenedSketch) in
  // sync with currentSketch, so the NEXT launch's mount effect above can
  // open straight back into wherever this session left off. Skipped while
  // currentSketch is null (a brand-new, never-yet-located sketch, e.g.
  // right after "new" -- see Frame's own handleNew) so quitting before
  // that sketch is ever saved/named doesn't overwrite the pointer to the
  // last REAL sketch with nothing addressable to reopen.
  useEffect(() => {
    if (currentSketch !== null)
      void window.rifffApi.saveLastOpenedSketch(JSON.stringify(currentSketch))
  }, [currentSketch])

  // Debounced crash-recovery autosave — fires AUTOSAVE_DEBOUNCE_MS after the
  // last real edit. Depends on the SERIALIZED content (a string), not state
  // itself, so a purely transient UI change (mode, volumeDragMode — both
  // already excluded from serializeProject's own output) produces the exact
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
  useEffect(() => {
    const id = window.setTimeout(() => {
      void window.rifffApi.autosaveProject(persistedJson)
      void window.rifffApi.autosaveProjectSketch(JSON.stringify(currentSketch))
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [persistedJson, currentSketch])
  const [pickerGroupId, setPickerGroupId] = useState<string | null>(null)
  const [riffLibraryOpen, setRiffLibraryOpen] = useState(false)
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
  function dismissOnboarding(dontShowAgain: boolean): void {
    setShowOnboarding(false)
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
    setShowOnboarding(true)
  }

  const [tourStepIndex, setTourStepIndex] = useState<number | null>(null)
  // The demo rifff's own groupId, once imported -- tracked so endTour can
  // delete exactly that rifff (and nothing the user may have added mid-
  // tour) rather than assuming it's the only thing on the timeline.
  const tourDemoGroupIdRef = useRef<string | null>(null)

  async function startTour(): Promise<void> {
    dispatch({ type: 'SET_ARRANGER_MODE', mode: 'normal' })
    const rifff = await window.rifffApi.importDemoRifff()
    if (!rifff) return
    tourDemoGroupIdRef.current = rifff.groupId
    dispatch({ type: 'ADD_TO_SHELF', rifff })
    dispatch({ type: 'PLACE_ON_TIMELINE', groupId: rifff.groupId, startBar: 0 })
    setTourStepIndex(0)
  }

  function endTour(): void {
    if (tourDemoGroupIdRef.current) {
      dispatch({ type: 'DELETE_RIFFFS', groupIds: [tourDemoGroupIdRef.current] })
      tourDemoGroupIdRef.current = null
    }
    setTourStepIndex(null)
  }
  const [libraryBrowserOpen, setLibraryBrowserOpen] = useState(false)
  const [clusterStemsOpen, setClusterStemsOpen] = useState(false)
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

  function handleOpenBeatPickerForEdit(groupId: string): void {
    setPickerGroupId(groupId)
    setPickerIsNewImport(false)
  }
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
              const action = pasteRifffAction(
                state,
                groupId,
                (rifff.startBar ?? 0) + rifff.barLength
              )
              if (action) dispatch(action)
            }
          },
          // Meaningless for an already-single-stem rifff — nothing to split.
          ...(rifff.stems.length > 1
            ? [{ label: 'ungroup', onClick: () => dispatch({ type: 'UNGROUP', groupId }) }]
            : []),
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
    [dispatch]
  )

  function openPasteMenu(x: number, y: number, bar: number): void {
    if (!clipboard || !state.rifffs[clipboard]) return
    setContextMenu({
      x,
      y,
      items: [
        {
          label: 'paste',
          onClick: () => {
            const action = pasteRifffAction(state, clipboard, bar)
            if (action) dispatch(action)
          }
        }
      ]
    })
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

  // V toggles volumeDragMode — see StemWaveformRow.tsx's waveform-body drag
  // handling and TransportBar's indicator button. Skipped while focus is in a
  // text input, matching Delete/undo above (typing "v" in the tempo field
  // shouldn't also flip the drag mode).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key.toLowerCase() !== 'v') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      dispatch({ type: 'TOGGLE_VOLUME_DRAG_MODE' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch])

  // Holding Option/Alt forces envelope drag mode on for as long as it's held,
  // then restores whatever volumeDragMode was before the key went down —
  // "restore" rather than "always turn off" so this composes correctly with
  // the V-key toggle above (holding Option while V-mode is already on is a
  // no-op either way; releasing it never fights an already-on V toggle).
  // SET_VOLUME_DRAG_MODE (not the TOGGLE action) is used deliberately here —
  // see its own doc comment in store.ts. e.repeat guards against the OS's
  // own key-repeat re-firing keydown continuously while held, which would
  // otherwise capture "true" as the previous value on the second repeat
  // instead of the real pre-hold value. The window blur listener is a safety
  // net for alt-tabbing (or any focus loss) away while Option is held, since
  // that can lose the keyup event entirely and would otherwise leave
  // envelope mode stuck on.
  const volumeDragModeRef = useRef(state.volumeDragMode)
  useEffect(() => {
    volumeDragModeRef.current = state.volumeDragMode
  }, [state.volumeDragMode])

  useEffect(() => {
    const holding = { current: false }
    const previousValue = { current: false }

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Alt' || e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      holding.current = true
      previousValue.current = volumeDragModeRef.current
      dispatch({ type: 'SET_VOLUME_DRAG_MODE', enabled: true })
    }
    function release(): void {
      if (!holding.current) return
      holding.current = false
      dispatch({ type: 'SET_VOLUME_DRAG_MODE', enabled: previousValue.current })
    }
    function handleKeyUp(e: KeyboardEvent): void {
      if (e.key !== 'Alt') return
      release()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', release)
    }
  }, [dispatch])

  // Shared by the TransportBar mode button and the Tab shortcut below --
  // nextArrangerMode already silently stays on 'normal' rather than landing
  // on a mode it can't show, but that read as broken rather than
  // unavailable: clicking (or hitting Tab) while ineligible visibly did
  // nothing, with the reason only discoverable by hovering the button's own
  // title text. This surfaces that same reason as an explicit explanation
  // at the moment the attempt is actually made.
  function handleCycleArrangerMode(): void {
    if (state.mode === 'normal' && !isSketchEligible(state)) {
      window.alert(
        'sketch mode requires a plain, back-to-back arrangement — no fades, offsets, or gaps.'
      )
      return
    }
    dispatch({ type: 'SET_ARRANGER_MODE', mode: nextArrangerMode(state) })
  }

  // Tab cycles the arranger mode, Ableton-style: normal -> compact -> sketch
  // -> normal, skipping sketch when isSketchEligible(state) is false (see
  // nextArrangerMode). Skipped while focus is in a text input — Tab's native
  // move-to-next-field behavior is more useful there than the arrangement's
  // own view-mode cycle (matches Delete/V/undo's same input-skip pattern).
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
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const key = e.key.toLowerCase()
      const isUndo = (e.metaKey || e.ctrlKey) && key === 'z' && !e.shiftKey
      const isRedo =
        ((e.metaKey || e.ctrlKey) && key === 'z' && e.shiftKey) || (e.ctrlKey && key === 'y')
      if (!isUndo && !isRedo) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      if (isRedo) history.redo()
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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // e.repeat guards against the OS's own key-repeat re-firing keydown
      // continuously while held -- same convention as the Option/Alt handler
      // above (see its own comment). Without this, holding \ down fires
      // enableGatedRecording()/lockInGatedRecording() many times in rapid
      // succession instead of once per physical press.
      if (e.key !== '\\' || e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      void (state.gatedRecordingEnabled ? lockInGatedRecording() : enableGatedRecording())
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enableGatedRecording/lockInGatedRecording aren't memoized (fresh closures every render), but close over nothing beyond state/dispatch/playing, all effectively covered by `state` already being listed -- listing them too would just re-bind the listener on every render instead of only when state actually changes, with no safety benefit.
  }, [state, dispatch])

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
      if (e.key !== '/') return
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
      <SketchModeAutoFollow />
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
                  ? 'untitled sketch'
                  : currentSketch.kind === 'library'
                    ? currentSketch.name
                    : basenameWithoutProjectExt(currentSketch.path)
              }
              rifffCount={Object.keys(state.rifffs).length}
              stemCount={Object.values(state.rifffs).reduce((n, r) => n + r.stems.length, 0)}
              onRename={(newName) => void handleRename(newName)}
              renameError={renameError}
              dirty={dirty}
            />
          </div>
          <div style={{ paddingRight: 14 }}>
            <ProjectMenu
              currentSketch={currentSketch}
              setCurrentSketch={setCurrentSketch}
              handleNew={handleNew}
              handleSave={handleSave}
              onOpenLibrary={() => setLibraryBrowserOpen(true)}
              onOpenClusterStems={() => setClusterStemsOpen(true)}
            />
          </div>
        </div>
        <Shelf onImported={handleImported} onOpenLibrary={() => setRiffLibraryOpen(true)} />
        <TransportBar
          onOpenClusterStems={() => setClusterStemsOpen(true)}
          onEnableGatedRecording={() => void enableGatedRecording()}
          onDisableGatedRecording={() => void disableGatedRecording()}
          onStop={() => void handleStop()}
          onShowWelcome={showWelcomeAgain}
          onOpenEndlesss={() => setRiffLibraryOpen(true)}
          mode={state.mode}
          sketchEligible={isSketchEligible(state)}
          onCycleMode={handleCycleArrangerMode}
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
              onWheel={handleTimelineWheel}
              style={{ height: '100%', overflowX: 'auto', overflowY: 'auto' }}
            >
              <Timeline
                onOpenClipMenu={openClipMenu}
                onOpenPasteMenu={openPasteMenu}
                onBackgroundMouseDown={handlePanMouseDown}
              />
            </div>
          </div>
          {/* Drawer handle — same subtle-strip visual language as the stem
            resize handles (StemWaveformRow/CollapsedRifffRow), just click
            instead of drag. Always present, on either side of the drawer, so
            there's a consistent single place to grab regardless of the
            Inspector's current state. */}
          <button
            onClick={() => dispatch({ type: 'TOGGLE_INSPECTOR_COLLAPSED' })}
            aria-label="Toggle inspector panel"
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
            <Inspector onOpenBeatPicker={handleOpenBeatPickerForEdit} />
          </div>
        </div>
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
              const siblingGroupIds = pickerBatchGroupIds.filter((id) => id !== pickerGroupId)
              for (const siblingGroupId of siblingGroupIds) {
                const siblingRifff = state.rifffs[siblingGroupId]
                if (!siblingRifff) continue
                void bakeStems(
                  dispatch,
                  siblingGroupId,
                  steps,
                  SNAP_DIVS[state.snapIdx],
                  siblingRifff.stems
                )
              }
            }}
          />
        )}
        {riffLibraryOpen && (
          <LibraryBrowser
            onClose={() => setRiffLibraryOpen(false)}
            onImported={handleLibraryImported}
          />
        )}
        {libraryBrowserOpen && (
          <ProjectLibraryBrowser
            onClose={() => setLibraryBrowserOpen(false)}
            currentLibraryName={
              currentSketch !== null && currentSketch.kind === 'library' ? currentSketch.name : null
            }
            onSelect={(name) => {
              void (async () => {
                setBusy('opening project…')
                try {
                  const result = await window.rifffApi.openLibrarySketch(name)
                  if (!result) return
                  const loaded = deserializeProject(JSON.parse(result.json))
                  setBusy('loading…')
                  await warmStemCaches(loaded)
                  dispatch({ type: 'LOAD_STATE', state: loaded })
                  lastSavedJsonRef.current = serializeProject(loaded)
                  setCurrentSketch({ kind: 'library', name })
                } catch (err) {
                  console.error('App: failed to open library sketch:', err)
                } finally {
                  setBusy(null)
                }
              })()
            }}
            onOpenFromDisk={() => {
              setLibraryBrowserOpen(false)
              void (async () => {
                setBusy('opening project…')
                try {
                  const result = await window.rifffApi.openProject()
                  if (!result) return
                  const loaded = deserializeProject(JSON.parse(result.json))
                  // Same pre-warm-before-LOAD_STATE reasoning as the onSelect
                  // handler right above -- see its own comment history.
                  setBusy('loading…')
                  await warmStemCaches(loaded)
                  dispatch({ type: 'LOAD_STATE', state: loaded })
                  lastSavedJsonRef.current = serializeProject(loaded)
                  setCurrentSketch({ kind: 'external', path: result.path })
                } catch (err) {
                  console.error('App: failed to open project from disk:', err)
                } finally {
                  setBusy(null)
                }
              })()
            }}
          />
        )}
        {clusterStemsOpen && <ClusterStemsBrowser onClose={() => setClusterStemsOpen(false)} />}
        {newProjectModal && (
          <NewProjectModal
            defaultName={newProjectModal.defaultName}
            onCreate={commitNewProject}
            onCancel={() => setNewProjectModal(null)}
          />
        )}
        {unsavedChangesPromptOpen && (
          <UnsavedChangesDialog
            onSave={() => resolveUnsavedChangesPrompt('save')}
            onDiscard={() => resolveUnsavedChangesPrompt('discard')}
            onCancel={() => resolveUnsavedChangesPrompt('cancel')}
          />
        )}
        <LockInConfirmDialog />
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
        {!showLibraryLocationSetup && showOnboarding && (
          <OnboardingModal
            onDismiss={dismissOnboarding}
            onOpenEndlesss={(dontShowAgain) => {
              dismissOnboarding(dontShowAgain)
              setRiffLibraryOpen(true)
            }}
            onStartTour={(dontShowAgain) => {
              const hasExistingContent = Object.keys(state.rifffs).length > 0
              if (
                hasExistingContent &&
                !window.confirm('Start the tour? This adds a demo rifff to your current sketch.')
              ) {
                return
              }
              dismissOnboarding(dontShowAgain)
              void startTour()
            }}
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
