import { type DragEvent } from 'react'
import { StoreProvider, useAppState, useDispatch } from './state/StoreContext'
import { Titlebar } from './components/Titlebar'
import { TransportBar } from './components/TransportBar'
import { Ruler, PPB, LANE_HEADER_WIDTH } from './components/Ruler'
import { Shelf } from './components/Shelf'
import { Inspector } from './components/Inspector'
import { RifffBlockRow } from './components/RifffBlockRow'
import { Playhead } from './components/Playhead'
import { serializeProject, deserializeProject } from './state/serialize'

function Timeline(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    const groupId = e.dataTransfer.getData('text/rifff-group-id')
    if (!groupId) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xInTimeline = e.clientX - rect.left - LANE_HEADER_WIDTH
    const startBar = Math.max(0, Math.round(xInTimeline / PPB))
    dispatch({ type: 'PLACE_ON_TIMELINE', groupId, startBar })
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      style={{ position: 'relative' }}
    >
      <Ruler />
      {Object.values(state.rifffs)
        .filter((r) => r.startBar !== undefined)
        .map((r) => (
          <RifffBlockRow key={r.groupId} groupId={r.groupId} />
        ))}
      <Playhead />
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

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={handleSave}>save</button>
      <button onClick={handleOpen}>open</button>
    </div>
  )
}

function Frame(): React.JSX.Element {
  const state = useAppState()
  return (
    <div className="ra-frame">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <Titlebar
            rifffCount={Object.keys(state.rifffs).length}
            stemCount={Object.values(state.rifffs).reduce((n, r) => n + r.stems.length, 0)}
          />
        </div>
        <ProjectMenu />
      </div>
      <Shelf />
      <TransportBar />
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1 }}>
          <Timeline />
        </div>
        <Inspector />
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
