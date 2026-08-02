import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type WheelEvent
} from 'react'
import {
  StoreProvider,
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
import { zoomMultiplierForWheelDelta, scrollLeftForZoomChange } from './components/zoomMath'
import { Shelf } from './components/Shelf'
import { Inspector } from './components/Inspector'
import { ChannelRow } from './components/ChannelRow'
import { COMPACT_ROW_HEIGHT } from './components/CompactRifffBlock'
import { SketchStrip } from './components/SketchStrip'
import { Playhead } from './components/Playhead'
import { BeatPicker, bakeStems, rebakeRifff } from './components/BeatPicker'
import { LoreLibraryBrowser } from './components/LoreLibraryBrowser'
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu'
import { serializeProject, deserializeProject } from './state/serialize'
import {
  loopLengthBars,
  pasteRifffAction,
  channelsInOrder,
  channelMuteLetters,
  nextArrangerMode,
  groupIdAtPosition
} from './state/selectors'
import { initialState, SNAP_DIVS } from './state/store'
import { applyGrabOffset, getGrabOffsetBars } from './components/dragGrabOffset'
import { startPointerDrag } from './components/dragUtils'
import { useHandModeHeld } from './components/useHandModeHeld'
import { stemKey, type Rifff } from '@shared/types'
import { pickBestRifffForReOne } from '@shared/reOneScoring'

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

// Always-present trailing empty bars past the arrangement's actual loop end —
// horizontal counterpart to GHOST_ROW_COUNT above. Display-only: added to
// loopLengthBars(state) just for the Ruler's rendered width, never to
// loopLengthBars itself, which also drives the real playback loop boundary
// (StoreContext.tsx) and export duration (nativeExport.ts) — padding those
// would silently add 4 bars of real silence to every export.
const TRAILING_BLANK_BARS = 4

function Timeline({
  onOpenClipMenu,
  onOpenPasteMenu
}: {
  onOpenClipMenu: (x: number, y: number, groupId: string) => void
  onOpenPasteMenu: (x: number, y: number, bar: number) => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const [dropBar, setDropBar] = useState<number | null>(null)
  const ppb = useZoom()

  // channelsInOrder rebuilds a Map plus fresh arrays every call -- Timeline
  // re-renders on every dispatch (useAppState subscribes to the whole
  // AppState), so without this it was doing that rebuild on every mute
  // toggle, volume drag tick, plugin selection, etc., not just the state
  // changes that actually affect channel membership/order.
  const channels = useMemo(
    () => channelsInOrder(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed to the only fields channelsInOrder actually reads; depending on `state` itself would recompute on every dispatch (a new object every time), defeating the point
    [state.rifffs, state.channelOf, state.channelOrder]
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
    if (playing) void window.rifffApi.engineSetPosition(bar)
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
  async function resolveDrop(
    e: DragEvent<HTMLDivElement>,
    targetChannelId: string | undefined
  ): Promise<void> {
    e.preventDefault()
    e.stopPropagation()
    setDropBar(null)
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
  }

  // The Timeline container's own catch-all — fires for anything a specific
  // ChannelRow's own onDrop (below) didn't already stop propagation for:
  // ghost rows, or any other background space. Always resolves to "give
  // this clip a brand new channel" (targetChannelId undefined).
  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    void resolveDrop(e, undefined)
  }

  // Passed to every ChannelRow — a drop that lands there always means
  // "reassign to (or land initially on) THIS channel."
  function handleDropOnChannel(e: DragEvent<HTMLDivElement>, channelId: string): void {
    void resolveDrop(e, channelId)
  }

  function handleContextMenu(e: MouseEvent<HTMLDivElement>): void {
    // Only reached for empty timeline space — RifffBlockRow's clip stops
    // propagation before this bubbles up, so a right-click on an actual clip
    // never also triggers the paste menu.
    e.preventDefault()
    onOpenPasteMenu(e.clientX, e.clientY, barForClientX(e.clientX, e.currentTarget, ppb))
  }

  if (state.mode === 'sketch') {
    return <SketchStrip />
  }

  const ghostRowHeight = state.mode === 'compact' ? COMPACT_ROW_HEIGHT : GHOST_ROW_HEIGHT

  return (
    <div
      data-timeline
      onDragOver={handleDragOver}
      onDragLeave={() => setDropBar(null)}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      onClick={handleBackgroundClick}
      style={{ position: 'relative' }}
    >
      <Ruler bars={loopLengthBars(state) + TRAILING_BLANK_BARS} ppb={ppb} />
      {channels.map((channel) => (
        <ChannelRow
          key={channel.channelId}
          channelId={channel.channelId}
          rifffs={channel.rifffs}
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

function ProjectMenu(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const [exporting, setExporting] = useState(false)
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null)

  function handleNew(): void {
    if (
      Object.keys(state.rifffs).length > 0 &&
      !window.confirm('Discard the current project and start a new one?')
    ) {
      return
    }
    dispatch({ type: 'LOAD_STATE', state: initialState })
  }

  async function handleSave(): Promise<void> {
    try {
      await window.rifffApi.saveProject(serializeProject(state))
    } catch (err) {
      console.error('ProjectMenu: failed to save project:', err)
    }
  }

  async function handleOpen(): Promise<void> {
    try {
      const result = await window.rifffApi.openProject()
      if (!result) return
      const loaded = deserializeProject(JSON.parse(result.json))
      dispatch({ type: 'LOAD_STATE', state: loaded })
    } catch (err) {
      console.error('ProjectMenu: failed to open project:', err)
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

  async function handleExportStems(): Promise<void> {
    setExporting(true)
    try {
      const stems = await window.rifffApi.exportStemsNative(JSON.stringify(state))
      await window.rifffApi.exportStems(stems)
    } catch (err) {
      console.error('ProjectMenu: failed to export stems:', err)
      window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
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
      <button onClick={handleSave} style={buttonStyle}>
        save
      </button>
      <button onClick={handleOpen} style={buttonStyle}>
        open
      </button>
      <button
        onClick={(e) => {
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
          items={[
            { label: 'export mix', onClick: handleExportMix },
            { label: 'export stems', onClick: handleExportStems }
          ]}
          onClose={() => setExportMenu(null)}
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

// Matches index.ts's own default BrowserWindow width -- see Frame's
// frameScale doc comment for why this is the one reference number the
// whole proportional-scaling scheme is built from.
const REFERENCE_WINDOW_WIDTH = 1512

function Frame(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const history = useHistory()
  const playing = usePlaying()
  const pos = usePos()
  const ppb = useZoom()

  // .ra-frame (global.css) is a fixed-size "design canvas" (matching the
  // app's default 1512x982 window, see index.ts) that gets uniformly
  // scaled via CSS transform to match the CURRENT window size, rather than
  // reflowing its fixed-pixel children (panel widths, fonts, buttons)
  // independently -- that keeps every part of the UI in the same
  // proportion to every other part at any window size, so shrinking
  // towards the window's minimum makes everything smaller together
  // instead of letting fixed-width chrome (e.g. the 308px Inspector) eat a
  // disproportionate share of a now-much-smaller timeline area.
  //
  // Derived from window.innerWidth alone, not innerHeight -- innerWidth
  // has no OS chrome to account for (a title bar only adds height), and
  // the window's own aspect ratio is already locked 3:2 (index.ts's
  // setAspectRatio), so width and height always change in lockstep.
  const [frameScale, setFrameScale] = useState(() => window.innerWidth / REFERENCE_WINDOW_WIDTH)
  useEffect(() => {
    function handleResize(): void {
      setFrameScale(window.innerWidth / REFERENCE_WINDOW_WIDTH)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Once, on mount: offer to restore a crash-recovery snapshot from a
  // previous session that never got explicitly saved (see projectFile.ts's
  // writeAutosave/loadAutosave/clearAutosave — a dedicated file, decoupled
  // from the user's own named .sssketchproj saves). Cleared either way once
  // answered, so a later launch doesn't keep asking about the same stale
  // snapshot.
  useEffect(() => {
    void (async () => {
      const json = await window.rifffApi.loadAutosave()
      if (!json) return
      if (window.confirm('Recover unsaved work from a previous session?')) {
        dispatch({ type: 'LOAD_STATE', state: deserializeProject(JSON.parse(json)) })
      }
      void window.rifffApi.clearAutosave()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run-once-on-mount; dispatch is stable
  }, [])

  // Debounced crash-recovery autosave — fires AUTOSAVE_DEBOUNCE_MS after the
  // last real edit. Depends on the SERIALIZED content (a string), not state
  // itself, so a purely transient UI change (mode, volumeDragMode — both
  // already excluded from serializeProject's own output) produces the exact
  // same string and doesn't reset the debounce timer for nothing.
  const persistedJson = useMemo(() => serializeProject(state), [state])
  useEffect(() => {
    const id = window.setTimeout(() => {
      void window.rifffApi.autosaveProject(persistedJson)
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [persistedJson])
  const [pickerGroupId, setPickerGroupId] = useState<string | null>(null)
  const [loreLibraryOpen, setLoreLibraryOpen] = useState(false)
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

  function handleLoreImported(groupIds: string[], rifffs?: Rifff[]): void {
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

  function openClipMenu(x: number, y: number, groupId: string): void {
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
            const action = pasteRifffAction(state, groupId, (rifff.startBar ?? 0) + rifff.barLength)
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
  }

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
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId: state.sel })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.sel, state.mode, state.rifffs, dispatch])

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
      dispatch({ type: playing ? 'PAUSE' : 'PLAY' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
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
      dispatch({ type: 'SET_ARRANGER_MODE', mode: nextArrangerMode(state) })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state, dispatch])

  // Shift+<qwerty letter> mutes/unmutes any currently-visible channel — see
  // channelMuteLetters' doc comment for the matching on-screen letter shown
  // on each channel's mute badge while Shift is held (StemWaveformRow,
  // CollapsedRifffRow). Global across every visible row now, not scoped to
  // the selected rifff — channelMuteLetters already guarantees unique
  // letters across all of them, so there's no more ambiguity to avoid.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!e.shiftKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const letters = channelMuteLetters(state)
      const pressedKey = e.key.toLowerCase()
      const channelKey = Object.keys(letters).find((k) => letters[k] === pressedKey)
      if (!channelKey) return
      e.preventDefault()
      // A bare groupId (no ':') is a collapsed row's whole-group channel;
      // otherwise it's stemKey(groupId, slot) for one expanded stem — see
      // channelMuteLetters' doc comment on how the two are told apart.
      const sepIndex = channelKey.lastIndexOf(':')
      if (sepIndex === -1) {
        const rifff = state.rifffs[channelKey]
        if (!rifff) return
        const allMuted = rifff.stems.every((s) => state.mute[stemKey(channelKey, s.slot)])
        dispatch({ type: 'SET_GROUP_MUTE', groupId: channelKey, muted: !allMuted })
      } else {
        dispatch({ type: 'TOGGLE_MUTE', stemKey: channelKey })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
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

  // Cmd/Ctrl+0 resets zoom to its default level -- the standard "reset
  // zoom" convention across creative and browser apps. Skipped while focus
  // is in a text input, same pattern as every other global shortcut here.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '0') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      dispatch({ type: 'RESET_ZOOM' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch])

  // Sketch mode only: while playing, the Inspector automatically shows
  // whichever rifff currently contains the playhead — no manual click
  // needed to follow along. Scoped to sketch mode specifically because it's
  // the only mode where "the currently playing rifff" is unambiguous
  // (Normal/Compact can have several playing across different rows at
  // once). Only dispatches SELECT when the playing rifff actually
  // CHANGES (a transition into a new one) — not on every ~30Hz position
  // tick — so a manual click on a different tile mid-playback sticks in
  // the Inspector until the next real transition, instead of snapping back
  // within the next tick.
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

  // Hold H to pan the arranger view by dragging anywhere in it, rather than
  // having to grab the scrollbar directly. The overlay below sits on top of
  // Timeline while held, capturing the drag itself so none of Timeline's own
  // click/drag interactions (select, move clip, resize...) fire underneath
  // it — cheaper than teaching every interactive element inside Timeline/
  // RifffBlockRow/SketchStrip/CompactRifffBlock to ignore mousedown while
  // hand mode is active.
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
    if (!(e.metaKey || e.ctrlKey)) return
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

  useEffect(() => {
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
  }, [ppb])

  // Sets the cursor at the document level (not just on the pan overlay div
  // below) so pressing M shows the hand immediately no matter where the
  // mouse already happens to be sitting — the overlay's own `cursor` style
  // only takes effect once the mouse actually enters the arranger area.
  useEffect(() => {
    if (!handModeHeld) return
    document.body.style.cursor = panning ? 'grabbing' : 'grab'
    return () => {
      document.body.style.cursor = ''
    }
  }, [handModeHeld, panning])

  function handlePanMouseDown(e: MouseEvent<HTMLDivElement>): void {
    const container = scrollContainerRef.current
    if (!container) return
    const startScrollLeft = container.scrollLeft
    setPanning(true)
    startPointerDrag(
      e,
      (deltaX) => {
        container.scrollLeft = startScrollLeft - deltaX
      },
      () => setPanning(false)
    )
  }

  return (
    <div className="ra-viewport">
      <div className="ra-frame" style={{ transform: `translate(-50%, -50%) scale(${frameScale})` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid var(--ra-border-soft)'
          }}
        >
          <div style={{ flex: 1 }}>
            <Titlebar
              rifffCount={Object.keys(state.rifffs).length}
              stemCount={Object.values(state.rifffs).reduce((n, r) => n + r.stems.length, 0)}
            />
          </div>
          <div style={{ paddingRight: 14 }}>
            <ProjectMenu />
          </div>
        </div>
        <Shelf onImported={handleImported} onOpenLoreLibrary={() => setLoreLibraryOpen(true)} />
        <TransportBar />
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
              style={{ height: '100%', overflowX: 'auto' }}
            >
              <Timeline onOpenClipMenu={openClipMenu} onOpenPasteMenu={openPasteMenu} />
            </div>
            {handModeHeld && (
              <div
                onMouseDown={handlePanMouseDown}
                title="drag to pan (release M to exit)"
                style={{
                  position: 'absolute',
                  inset: 0,
                  cursor: panning ? 'grabbing' : 'grab',
                  zIndex: 10
                }}
              />
            )}
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
              if (wasBatchImport) setLoreLibraryOpen(false)
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
        {loreLibraryOpen && (
          <LoreLibraryBrowser
            onClose={() => setLoreLibraryOpen(false)}
            onImported={handleLoreImported}
          />
        )}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <StoreProvider>
      <Frame />
    </StoreProvider>
  )
}
