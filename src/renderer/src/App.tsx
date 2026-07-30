import { useEffect, useState, type DragEvent, type MouseEvent } from 'react'
import {
  StoreProvider,
  useAppState,
  useDispatch,
  useHistory,
  usePlaying
} from './state/StoreContext'
import { Titlebar } from './components/Titlebar'
import { TransportBar } from './components/TransportBar'
import { Ruler, PPB } from './components/Ruler'
import { Shelf } from './components/Shelf'
import { Inspector } from './components/Inspector'
import { RifffBlockRow } from './components/RifffBlockRow'
import { Playhead } from './components/Playhead'
import { BeatPicker, bakeStems } from './components/BeatPicker'
import { LoreLibraryBrowser } from './components/LoreLibraryBrowser'
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu'
import { serializeProject, deserializeProject } from './state/serialize'
import {
  loopLengthBars,
  pasteRifffAction,
  placedRifffsInOrder,
  channelMuteLetters
} from './state/selectors'
import { initialState, SNAP_DIVS } from './state/store'
import { applyGrabOffset, getGrabOffsetBars } from './components/dragGrabOffset'
import { stemKey } from '@shared/types'

function barForClientX(clientX: number, container: HTMLDivElement): number {
  const rect = container.getBoundingClientRect()
  const xInTimeline = clientX - rect.left
  return Math.max(0, Math.round(xInTimeline / PPB))
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
  const [dropBar, setDropBar] = useState<number | null>(null)

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDropBar(applyGrabOffset(barForClientX(e.clientX, e.currentTarget), getGrabOffsetBars()))
    // Cmd/Ctrl-drag duplicates a placed clip instead of moving it (see
    // handleDrop's text/rifff-group-id branch) — this just gives the OS its
    // own native "copy" cursor treatment (a green + badge on macOS) while
    // the modifier is held, matching how Finder/most other drag-and-drop
    // apps signal the same thing.
    e.dataTransfer.dropEffect = e.metaKey || e.ctrlKey ? 'copy' : 'move'
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDropBar(null)
    const startBar = applyGrabOffset(barForClientX(e.clientX, e.currentTarget), getGrabOffsetBars())

    // Checked first — more specific than a whole-group drag, and the two payloads
    // are never both set on the same drop (StemWaveformRow only sets this one,
    // and only while its stem's group is unlinked).
    const stemDragKey = e.dataTransfer.getData('text/rifff-stem-key')
    if (stemDragKey) {
      dispatch({ type: 'SET_STEM_START', key: stemDragKey, startBar })
      return
    }

    // From the shelf — either the rifff's first-ever placement, or (if it's
    // already placed elsewhere) an independent copy, never a reposition of an
    // existing clip (that's 'text/rifff-group-id', below).
    const shelfSourceId = e.dataTransfer.getData('text/rifff-shelf-source-id')
    if (shelfSourceId) {
      const source = state.rifffs[shelfSourceId]
      if (!source) return
      if (source.startBar === undefined) {
        dispatch({ type: 'PLACE_ON_TIMELINE', groupId: shelfSourceId, startBar })
      } else {
        const action = pasteRifffAction(state, shelfSourceId, startBar)
        if (action) dispatch(action)
      }
      return
    }

    const groupId = e.dataTransfer.getData('text/rifff-group-id')
    if (!groupId) return
    // Cmd/Ctrl held at drop = duplicate rather than move: same
    // pasteRifffAction already used for "drag an already-placed shelf item
    // to a new spot" above, leaving the original exactly where it was and
    // dropping an independent copy at the new position instead.
    if (e.metaKey || e.ctrlKey) {
      const action = pasteRifffAction(state, groupId, startBar)
      if (action) dispatch(action)
      return
    }
    dispatch({ type: 'PLACE_ON_TIMELINE', groupId, startBar })
  }

  function handleContextMenu(e: MouseEvent<HTMLDivElement>): void {
    // Only reached for empty timeline space — RifffBlockRow's clip stops
    // propagation before this bubbles up, so a right-click on an actual clip
    // never also triggers the paste menu.
    e.preventDefault()
    onOpenPasteMenu(e.clientX, e.clientY, barForClientX(e.clientX, e.currentTarget))
  }

  return (
    <div
      data-timeline
      onDragOver={handleDragOver}
      onDragLeave={() => setDropBar(null)}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      style={{ position: 'relative' }}
    >
      <Ruler bars={loopLengthBars(state) + TRAILING_BLANK_BARS} />
      {placedRifffsInOrder(state).map((r) => (
        <RifffBlockRow key={r.groupId} groupId={r.groupId} onOpenContextMenu={onOpenClipMenu} />
      ))}
      {Array.from({ length: GHOST_ROW_COUNT }, (_, i) => (
        <div
          key={`ghost-${i}`}
          style={{
            height: GHOST_ROW_HEIGHT,
            borderBottom: '1px dashed var(--ra-border)'
          }}
        />
      ))}
      <Playhead />
      {dropBar !== null && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: dropBar * PPB,
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

function Frame(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const history = useHistory()
  const playing = usePlaying()
  const [pickerGroupId, setPickerGroupId] = useState<string | null>(null)
  const [loreLibraryOpen, setLoreLibraryOpen] = useState(false)
  // Riffs imported together as a LORE library batch, sharing the same jam's
  // clock phase — set alongside pickerGroupId so BeatPicker opens for just
  // the first one; once that one is baked, onBaked below applies the same
  // offset to the rest automatically, rather than opening the picker again
  // for each. Cleared unconditionally whenever BeatPicker closes (baked or
  // not), so a stale batch never leaks into some later, unrelated pick.
  const [pickerBatchSiblingGroupIds, setPickerBatchSiblingGroupIds] = useState<string[]>([])
  // Whether the CURRENT BeatPicker session was opened for a multi-riff LORE
  // batch import, as opposed to a single import or an unrelated re-pick via
  // the Inspector's own button — read (and reset) in BeatPicker's onClose
  // below, not in onBaked, since onBaked clears pickerBatchSiblingGroupIds
  // (and runs, if at all, before onClose) and a closed-without-picking
  // session still needs this to have survived to that point.
  const [pickerWasBatchImport, setPickerWasBatchImport] = useState(false)

  function handleLoreImported(groupIds: string[]): void {
    if (groupIds.length === 0) return
    setPickerGroupId(groupIds[0])
    setPickerBatchSiblingGroupIds(groupIds.slice(1))
    setPickerWasBatchImport(groupIds.length > 1)
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
    const unlinked = !!state.unlinked[groupId]
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
        {
          label: unlinked ? 'relink' : 'unlink',
          onClick: () => dispatch({ type: unlinked ? 'RELINK' : 'UNLINK', groupId })
        },
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
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId: state.sel })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.sel, dispatch])

  // Space toggles play/pause, the standard DAW convention. Skipped whenever the
  // beat-picker is open (it owns spacebar for tap-to-mark while it's up) or focus
  // is on a naturally space-activated control (typing a space, or triggering a
  // focused button/checkbox) — only intercepted when space wouldn't otherwise do
  // anything useful.
  useEffect(() => {
    const interactiveTags = new Set(['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'])
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.code !== 'Space' || pickerGroupId) return
      const target = e.target as HTMLElement | null
      if (target && interactiveTags.has(target.tagName)) return
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

  // Tab toggles compact mode, Ableton-style ("this could switch between
  // compact mode"). Skipped while focus is in a text input — Tab's native
  // move-to-next-field behavior is more useful there than the arrangement's
  // own view-mode toggle (matches Delete/V/undo's same input-skip pattern).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      dispatch({ type: 'TOGGLE_COMPACT_MODE' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch])

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

  return (
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
            rifffCount={Object.keys(state.rifffs).length}
            stemCount={Object.values(state.rifffs).reduce((n, r) => n + r.stems.length, 0)}
          />
        </div>
        <div style={{ paddingRight: 14 }}>
          <ProjectMenu />
        </div>
      </div>
      <Shelf onImported={setPickerGroupId} onOpenLoreLibrary={() => setLoreLibraryOpen(true)} />
      <TransportBar />
      <div style={{ display: 'flex' }}>
        {/* minWidth:0 lets this flex item shrink below its content's intrinsic
            width, which is what allows overflow-x:auto to actually kick in
            instead of the row silently stretching .ra-frame's fixed width. */}
        <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
          <Timeline onOpenClipMenu={openClipMenu} onOpenPasteMenu={openPasteMenu} />
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
            overflow: 'hidden',
            transition: 'width 150ms ease'
          }}
        >
          <Inspector onOpenBeatPicker={setPickerGroupId} />
        </div>
      </div>
      {pickerGroupId && state.rifffs[pickerGroupId] && (
        <BeatPicker
          groupId={pickerGroupId}
          onClose={() => {
            setPickerGroupId(null)
            setPickerBatchSiblingGroupIds([])
            // A batch import means "I picked everything I wanted, now let's
            // arrange" — close the library along with the picker so it
            // doesn't linger in the way. A single import means "I'm
            // browsing one at a time" — leave the library open (it never
            // auto-closes on its own) so the next pick is right there.
            if (pickerWasBatchImport) setLoreLibraryOpen(false)
            setPickerWasBatchImport(false)
          }}
          onBaked={(steps) => {
            for (const siblingGroupId of pickerBatchSiblingGroupIds) {
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
            setPickerBatchSiblingGroupIds([])
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
  )
}

export default function App(): React.JSX.Element {
  return (
    <StoreProvider>
      <Frame />
    </StoreProvider>
  )
}
