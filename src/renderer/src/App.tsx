import { useEffect, useState, type DragEvent } from 'react'
import { StoreProvider, useAppState, useDispatch } from './state/StoreContext'
import { Titlebar } from './components/Titlebar'
import { TransportBar } from './components/TransportBar'
import { Ruler, PPB, LANE_HEADER_WIDTH } from './components/Ruler'
import { Shelf } from './components/Shelf'
import { Inspector } from './components/Inspector'
import { RifffBlockRow } from './components/RifffBlockRow'
import { Playhead } from './components/Playhead'
import { BeatPicker } from './components/BeatPicker'
import { serializeProject, deserializeProject } from './state/serialize'
import { loopLengthBars } from './state/selectors'

function dropBarForEvent(e: DragEvent<HTMLDivElement>): number {
  const rect = e.currentTarget.getBoundingClientRect()
  const xInTimeline = e.clientX - rect.left - LANE_HEADER_WIDTH
  return Math.max(0, Math.round(xInTimeline / PPB))
}

function Timeline(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const [dropBar, setDropBar] = useState<number | null>(null)

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDropBar(dropBarForEvent(e))
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDropBar(null)
    const startBar = dropBarForEvent(e)

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

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={() => setDropBar(null)}
      onDrop={handleDrop}
      style={{ position: 'relative' }}
    >
      <Ruler bars={loopLengthBars(state)} />
      {Object.values(state.rifffs)
        .filter((r) => r.startBar !== undefined)
        .map((r) => (
          <RifffBlockRow key={r.groupId} groupId={r.groupId} />
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
    </div>
  )
}

function Frame(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const [pickerGroupId, setPickerGroupId] = useState<string | null>(null)

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
          <Timeline />
        </div>
        <Inspector onOpenBeatPicker={setPickerGroupId} />
      </div>
      {pickerGroupId && state.rifffs[pickerGroupId] && (
        <BeatPicker groupId={pickerGroupId} onClose={() => setPickerGroupId(null)} />
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
