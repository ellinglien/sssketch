import { useState, type DragEvent } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'

export function Shelf(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const [dragOver, setDragOver] = useState(false)

  async function handleDrop(e: DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    // Electron no longer augments dropped File objects with a real `.path` (removed
    // as of Electron 32+); resolve each one's filesystem path via the preload bridge.
    const paths = Array.from(e.dataTransfer.files).map((f) => window.rifffApi.getPathForFile(f))
    if (paths.length === 0) return
    const rifff = await window.rifffApi.importRifff(paths)
    if (rifff) dispatch({ type: 'ADD_TO_SHELF', rifff })
  }

  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--ra-bg-rail)',
        borderBottom: '1px solid var(--ra-border)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span className="ra-eyebrow">shelf</span>
        <span style={{ fontSize: 10, color: 'var(--ra-text-4)' }}>
          drag one down into the arrangement · stems land linked and pre-aligned
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {Object.values(state.rifffs).map((rifff) => (
          <div
            key={rifff.groupId}
            style={{
              width: 212,
              borderRadius: 8,
              padding: '9px 10px',
              background: 'var(--ra-bg-frame)',
              border: '1px solid var(--ra-border)'
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700 }}>{rifff.name}</div>
            <div style={{ fontSize: 9, color: 'var(--ra-text-2)' }}>
              {rifff.bpm} BPM · {rifff.stems.length} stems · {rifff.barLength} bars
            </div>
          </div>
        ))}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            flex: 1,
            minWidth: 150,
            height: 78,
            border: `1px dashed ${dragOver ? 'var(--ra-text-2)' : 'var(--ra-border-strong)'}`,
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: 'var(--ra-text-3)',
            textAlign: 'center'
          }}
        >
          <div>drop rifff folders, or stems straight from endlesss</div>
          <div>copied into your rifff library</div>
        </div>
      </div>
    </div>
  )
}
