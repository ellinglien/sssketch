import { useState, type DragEvent } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { classifyStems } from '../audio/classifyStems'
import { setGrabOffsetBars } from './dragGrabOffset'

export function Shelf({
  onImported
}: {
  onImported: (groupId: string) => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const [dragOver, setDragOver] = useState(false)

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
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/rifff-group-id', rifff.groupId)
              // Not yet placed — there's no existing on-timeline position to
              // preserve an offset from, and without this the module could
              // still be holding a stale value left behind by a previous
              // in-arranger reposition drag.
              setGrabOffsetBars(0)
            }}
            style={{
              width: 212,
              borderRadius: 8,
              padding: '9px 10px',
              background: 'var(--ra-bg-frame)',
              border: '1px solid var(--ra-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <PolarGlyph
              stems={rifff.stems}
              identityColor={typeColorVar(rifff.stems[0]?.type ?? 'fx')}
              size={40}
            />
            <div style={{ overflow: 'hidden' }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {rifff.name}
              </div>
              <div style={{ fontSize: 9, color: 'var(--ra-text-2)' }}>
                {rifff.bpm} BPM · {rifff.stems.length} stems · {rifff.barLength} bars
              </div>
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
