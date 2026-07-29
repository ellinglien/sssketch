import { useState, type DragEvent } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { classifyStems } from '../audio/classifyStems'
import { setGrabOffsetBars } from './dragGrabOffset'

const TILE_SIZE = 42

export function Shelf({
  onImported
}: {
  onImported: (groupId: string) => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const [dragOver, setDragOver] = useState(false)
  // Hovering a tile previews its meta in the header line without changing
  // selection — falls back to the current selection so the line isn't just
  // blank whenever the mouse isn't over the tray at all.
  const [hoverId, setHoverId] = useState<string | null>(null)

  async function handleDrop(e: DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    // Electron no longer augments dropped File objects with a real `.path` (removed
    // as of Electron 32+); resolve each one's filesystem path via the preload bridge.
    const paths = Array.from(e.dataTransfer.files).map((f) => window.rifffApi.getPathForFile(f))
    if (paths.length === 0) {
      // Diagnostic only, not a fix: some source apps (e.g. Endlesss) may not put
      // real OS file entries on the drag at all, in which case dataTransfer.files
      // is empty and there's nothing we can import. Logging what the drag actually
      // carried makes that distinguishable from "we dropped it wrong" next time.
      console.warn(
        'Shelf: drop had no usable files. dataTransfer.types:',
        e.dataTransfer.types,
        'items:',
        Array.from(e.dataTransfer.items).map((i) => ({ kind: i.kind, type: i.type }))
      )
      return
    }
    try {
      const rifff = await window.rifffApi.importRifff(paths)
      if (rifff) {
        dispatch({ type: 'ADD_TO_SHELF', rifff })
        // Downbeat correction now happens right at import, not on first
        // placement — by the time it's dragged onto the timeline it's already
        // baked and usable, rather than needing a separate step afterward.
        onImported(rifff.groupId)
        // Not awaited — a quick heuristic guess (bass/drums only; everything
        // else stays 'fx') that fills in shortly after import without blocking
        // it or the beat-picker opening.
        classifyStems(rifff, dispatch).catch((err) => {
          console.error('Shelf: failed to classify stem types:', err)
        })
      }
    } catch (err) {
      // importRifff normally swallows its own errors and resolves null; this only
      // fires for something unexpected at the IPC layer itself (e.g. the main
      // process handler throwing before returning). No notification UI exists yet
      // (Task 10 doesn't add one) — surface it to the console so it's at least
      // discoverable rather than a silent no-op.
      console.error('importRifff failed:', err)
    }
  }

  const library = Object.values(state.rifffs)
  const detailRifff = state.rifffs[hoverId ?? state.sel ?? ''] ?? null

  return (
    <div
      style={{
        padding: '11px 14px',
        background: 'var(--ra-bg-rail)',
        borderBottom: '1px solid var(--ra-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 9
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, height: 14 }}>
        <span className="ra-eyebrow">rifff library</span>
        <span style={{ fontSize: 9, color: 'var(--ra-text-4)' }}>{library.length}</span>
        <span style={{ flex: 1 }} />
        {detailRifff && (
          <span style={{ fontSize: 9, color: 'var(--ra-text-2)', whiteSpace: 'nowrap' }}>
            {detailRifff.name} — {detailRifff.bpm} BPM · {detailRifff.stems.length} stems ·{' '}
            {detailRifff.barLength} bars
          </span>
        )}
      </div>
      <div
        onMouseLeave={() => setHoverId(null)}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}
      >
        {library.map((rifff) => {
          const selected = state.sel === rifff.groupId
          const hovered = hoverId === rifff.groupId
          // Already placed on the timeline reads as "in use" — full opacity,
          // same as selected/hovered; everything else dims slightly so the
          // tray doubles as an at-a-glance map of what's already in the
          // arrangement, mirroring the imported/6b mockup's own convention.
          const lit = selected || hovered || rifff.startBar !== undefined
          return (
            <button
              key={rifff.groupId}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/rifff-shelf-source-id', rifff.groupId)
                // Not yet placed — there's no existing on-timeline position to
                // preserve an offset from, and without this the module could
                // still be holding a stale value left behind by a previous
                // in-arranger reposition drag.
                setGrabOffsetBars(0)
              }}
              onMouseEnter={() => setHoverId(rifff.groupId)}
              onClick={() => dispatch({ type: 'SELECT', groupId: rifff.groupId })}
              title={rifff.name}
              style={{
                width: TILE_SIZE,
                height: TILE_SIZE,
                flex: 'none',
                padding: 2,
                border: `1px solid ${selected ? 'var(--ra-text)' : hovered ? 'var(--ra-border-strong)' : 'transparent'}`,
                borderRadius: 0,
                cursor: 'grab',
                background: 'transparent',
                opacity: lit ? 1 : 0.72
              }}
            >
              <PolarGlyph
                stems={rifff.stems}
                identityColor={typeColorVar(rifff.stems[0]?.type ?? 'fx')}
                size={TILE_SIZE - 4}
              />
            </button>
          )
        })}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          title="drop rifff folders, or stems straight from endlesss"
          style={{
            flex: 1,
            minWidth: 150,
            height: TILE_SIZE,
            border: `1px dashed ${dragOver ? 'var(--ra-text-2)' : 'var(--ra-border)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 15,
            color: 'var(--ra-text-4)'
          }}
        >
          +
        </div>
      </div>
    </div>
  )
}
