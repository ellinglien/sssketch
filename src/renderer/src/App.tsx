import { useEffect, useState, type DragEvent, type MouseEvent } from 'react'
import { StoreProvider, useAppState, useDispatch, useHistory } from './state/StoreContext'
import { Titlebar } from './components/Titlebar'
import { TransportBar } from './components/TransportBar'
import { Ruler, PPB, LANE_HEADER_WIDTH } from './components/Ruler'
import { Shelf } from './components/Shelf'
import { Inspector } from './components/Inspector'
import { RifffBlockRow } from './components/RifffBlockRow'
import { Playhead } from './components/Playhead'
import { BeatPicker } from './components/BeatPicker'
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu'
import { serializeProject, deserializeProject } from './state/serialize'
import { loopLengthBars, pasteRifffAction } from './state/selectors'

function barForClientX(clientX: number, container: HTMLDivElement): number {
  const rect = container.getBoundingClientRect()
  const xInTimeline = clientX - rect.left - LANE_HEADER_WIDTH
  return Math.max(0, Math.round(xInTimeline / PPB))
}

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
    setDropBar(barForClientX(e.clientX, e.currentTarget))
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDropBar(null)
    const startBar = barForClientX(e.clientX, e.currentTarget)

    // Checked first — more specific than a whole-group drag, and the two payloads
    // are never both set on the same drop (StemSubRow only sets this one).
    const stemDragKey = e.dataTransfer.getData('text/rifff-stem-key')
    if (stemDragKey) {
      dispatch({ type: 'SET_STEM_START', key: stemDragKey, startBar })
      return
    }

    const groupId = e.dataTransfer.getData('text/rifff-group-id')
    if (!groupId) return
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
      onDragOver={handleDragOver}
      onDragLeave={() => setDropBar(null)}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
      style={{ position: 'relative' }}
    >
      <Ruler bars={loopLengthBars(state)} />
      {Object.values(state.rifffs)
        .filter((r) => r.startBar !== undefined)
        .map((r) => (
          <RifffBlockRow key={r.groupId} groupId={r.groupId} onOpenContextMenu={onOpenClipMenu} />
        ))}
      <Playhead />
      {dropBar !== null && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: LANE_HEADER_WIDTH + dropBar * PPB,
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

  async function handleExport(): Promise<void> {
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

  const buttonStyle = {
    height: 22,
    borderRadius: 6,
    padding: '0 10px',
    fontSize: 10,
    border: '1px solid var(--ra-border)',
    background: 'var(--ra-bg-row-active)',
    color: 'var(--ra-text-2)'
  } as const

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={handleSave} style={buttonStyle}>
        save
      </button>
      <button onClick={handleOpen} style={buttonStyle}>
        open
      </button>
      <button
        onClick={handleExport}
        disabled={exporting}
        style={{ ...buttonStyle, color: exporting ? 'var(--ra-text-4)' : buttonStyle.color }}
      >
        {exporting ? 'rendering…' : 'export mix'}
      </button>
    </div>
  )
}

function Frame(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const history = useHistory()
  const [pickerGroupId, setPickerGroupId] = useState<string | null>(null)
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
      dispatch({ type: state.playing ? 'PAUSE' : 'PLAY' })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pickerGroupId, state.playing, dispatch])

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
      <Shelf onImported={setPickerGroupId} />
      <TransportBar />
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1 }}>
          <Timeline onOpenClipMenu={openClipMenu} onOpenPasteMenu={openPasteMenu} />
        </div>
        <Inspector onOpenBeatPicker={setPickerGroupId} />
      </div>
      {pickerGroupId && state.rifffs[pickerGroupId] && (
        <BeatPicker groupId={pickerGroupId} onClose={() => setPickerGroupId(null)} />
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
