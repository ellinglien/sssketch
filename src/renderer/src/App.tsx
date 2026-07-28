import { type DragEvent } from 'react'
import { StoreProvider, useAppState, useDispatch } from './state/StoreContext'
import { Titlebar } from './components/Titlebar'
import { TransportBar } from './components/TransportBar'
import { Ruler, PPB, LANE_HEADER_WIDTH } from './components/Ruler'
import { Shelf } from './components/Shelf'
import { Inspector } from './components/Inspector'
import { RifffBlockRow } from './components/RifffBlockRow'
import { Playhead } from './components/Playhead'

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

function Frame(): React.JSX.Element {
  const state = useAppState()
  return (
    <div className="ra-frame">
      <Titlebar
        rifffCount={Object.keys(state.rifffs).length}
        stemCount={Object.values(state.rifffs).reduce((n, r) => n + r.stems.length, 0)}
      />
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
