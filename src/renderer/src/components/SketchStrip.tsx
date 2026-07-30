import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { placedRifffsInOrder } from '../state/selectors'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { getAudioContext } from '../audio/peakCache'
import {
  startPreviewLoop,
  stopPreviewSources,
  registerActivePreview,
  unregisterActivePreview
} from '../audio/previewLoop'
import { stemKey } from '@shared/types'
import type { Rifff } from '@shared/types'

export const TILE_SIZE = 64
export const TILE_GAP = 10

/** Sketch mode's own view — a single left-to-right sequence of every placed
 * rifff, packed edge to edge (see isSketchEligible: this is only ever
 * mounted when that's already true, so `startBar` is already contiguous
 * from 0 — this component just reads it, it doesn't enforce it). Each tile
 * is a uniform-size PolarGlyph (the same radial-waveform circle used in the
 * shelf and LORE library browser); duration is communicated only through
 * the orbiting playhead dot's lap speed, not tile size, so the strip stays
 * visually even regardless of how long each rifff actually is. */
export function SketchStrip(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const pos = usePos()

  // Sorted by startBar (not placedRifffsInOrder's own trackOrder-based row
  // order) — SEQUENCE_RIFFFS keeps the two in sync, but startBar is the
  // actual source of truth for playback order, so render from that
  // directly rather than trusting they never drift apart.
  const sequence = [...placedRifffsInOrder(state)].sort(
    (a, b) => (a.startBar ?? 0) - (b.startBar ?? 0)
  )

  const [previewingGroupId, setPreviewingGroupId] = useState<string | null>(null)
  const previewSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const previewGenerationRef = useRef(0)
  const previewTokenRef = useRef(0)

  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Nearest gap between tiles, by clientX — tiles are uniform width + a
  // fixed gap, so this is direct arithmetic against the container's own
  // left edge rather than needing per-tile getBoundingClientRect calls.
  function insertionIndexForClientX(clientX: number): number {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return sequence.length
    const relativeX = clientX - rect.left
    const slot = TILE_SIZE + TILE_GAP
    return Math.max(0, Math.min(sequence.length, Math.round(relativeX / slot)))
  }

  const stopTilePreview = useCallback(() => {
    stopPreviewSources(previewSourcesRef.current)
    previewSourcesRef.current = []
    unregisterActivePreview(previewTokenRef.current)
  }, [])

  useEffect(() => {
    return () => stopTilePreview()
  }, [stopTilePreview])

  function handleTileClick(rifff: Rifff): void {
    dispatch({ type: 'SELECT', groupId: rifff.groupId })
    previewGenerationRef.current += 1
    const generation = previewGenerationRef.current
    stopTilePreview()
    if (previewingGroupId === rifff.groupId) {
      setPreviewingGroupId(null)
      return
    }
    setPreviewingGroupId(rifff.groupId)
    if (playing) dispatch({ type: 'PAUSE' })
    void startPreviewLoop(
      getAudioContext(),
      rifff.stems.map((s) => ({
        path: s.path,
        gain: state.vol[stemKey(rifff.groupId, s.slot)] ?? 1
      })),
      () => previewGenerationRef.current !== generation
    ).then((sources) => {
      if (previewGenerationRef.current !== generation) {
        stopPreviewSources(sources)
        return
      }
      previewSourcesRef.current.push(...sources)
      if (sources.length > 0) previewTokenRef.current = registerActivePreview(stopTilePreview)
    })
  }

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => {
        e.preventDefault()
        setDropIndex(insertionIndexForClientX(e.clientX))
      }}
      onDragLeave={() => setDropIndex(null)}
      onDrop={(e) => {
        e.preventDefault()
        const index = insertionIndexForClientX(e.clientX)
        setDropIndex(null)
        const draggedGroupId = e.dataTransfer.getData('text/rifff-group-id')
        if (!draggedGroupId || !sequence.some((r) => r.groupId === draggedGroupId)) return
        const withoutDragged = sequence.map((r) => r.groupId).filter((id) => id !== draggedGroupId)
        // index was computed against the FULL sequence (including the
        // dragged tile's own old slot) — if the drop lands after where it
        // used to be, removing it first shifts every later index down by
        // one, so the clamped insertion point needs the same adjustment.
        const oldIndex = sequence.findIndex((r) => r.groupId === draggedGroupId)
        const adjustedIndex = index > oldIndex ? index - 1 : index
        withoutDragged.splice(adjustedIndex, 0, draggedGroupId)
        dispatch({ type: 'SEQUENCE_RIFFFS', groupIds: withoutDragged })
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: TILE_GAP,
        padding: 24,
        flexWrap: 'wrap'
      }}
    >
      {sequence.map((rifff, index) => {
        const start = rifff.startBar ?? 0
        const isCurrent = playing && pos >= start && pos < start + rifff.barLength
        // 0..1 progress through this rifff's own play window — only
        // meaningful while isCurrent, but harmless to compute either way.
        const fraction = (pos - start) / rifff.barLength
        const angleRad = fraction * 2 * Math.PI - Math.PI / 2 // start at 12 o'clock
        const orbitRadius = 46 // just outside PolarGlyph's own outermost ring
        const dotX = 50 + orbitRadius * Math.cos(angleRad)
        const dotY = 50 + orbitRadius * Math.sin(angleRad)

        return (
          <div
            key={rifff.groupId}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/rifff-group-id', rifff.groupId)}
            onClick={() => handleTileClick(rifff)}
            title={rifff.name}
            style={{
              order: index * 10,
              position: 'relative',
              width: TILE_SIZE,
              height: TILE_SIZE,
              cursor: 'pointer',
              // Very subtle — intentionally minimal, first thing to cut if it
              // reads as too much once it's actually running.
              boxShadow: isCurrent
                ? '0 0 10px 1px color-mix(in srgb, var(--ra-text) 35%, transparent)'
                : 'none',
              opacity: state.sel === rifff.groupId || previewingGroupId === rifff.groupId ? 1 : 0.85
            }}
          >
            <PolarGlyph
              stems={rifff.stems}
              identityColor={typeColorVar(rifff.stems[0]?.type ?? 'fx')}
              size={TILE_SIZE}
            />
            {isCurrent && (
              <svg
                width={TILE_SIZE}
                height={TILE_SIZE}
                viewBox="0 0 100 100"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                <circle cx={dotX} cy={dotY} r={2.5} fill="var(--ra-playhead)" />
              </svg>
            )}
          </div>
        )
      })}
      {dropIndex !== null && (
        <div
          style={{
            order: dropIndex * 10 - 5,
            width: 2,
            height: TILE_SIZE,
            background: 'var(--ra-play-on)',
            pointerEvents: 'none'
          }}
        />
      )}
      {sequence.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)', padding: '8px 0' }}>
          drag rifffs in from the shelf or LORE library to start a sketch
        </div>
      )}
    </div>
  )
}
