import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { placedRifffsInOrder, pasteRifffAction } from '../state/selectors'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
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

  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Batch selection (shift-click range, cmd/ctrl-click toggle) — same
  // convention as Shelf's own multi-select. Separate from state.sel, which
  // stays the single "anchor" tile a plain click always collapses back to.
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set())

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

  // Removes one or more tiles and re-packs whatever remains, in one
  // SEQUENCE_RIFFFS dispatch regardless of how many were removed.
  const removeTiles = useCallback(
    (groupIds: Set<string>) => {
      const remaining = sequence.map((r) => r.groupId).filter((id) => !groupIds.has(id))
      for (const groupId of groupIds) dispatch({ type: 'REMOVE_FROM_TIMELINE', groupId })
      dispatch({ type: 'SEQUENCE_RIFFFS', groupIds: remaining })
    },
    [sequence, dispatch]
  )

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const targets =
        multiSelected.size > 0
          ? multiSelected
          : new Set(state.sel && sequence.some((r) => r.groupId === state.sel) ? [state.sel] : [])
      if (targets.size === 0) return
      removeTiles(targets)
      setMultiSelected(new Set())
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.sel, sequence, multiSelected, removeTiles])

  // Shift-click extends/shrinks a range from the current anchor (state.sel);
  // cmd/ctrl-click toggles just the clicked tile in/out of the batch — same
  // convention as Shelf's own multi-select, and neither jumps/plays, unlike
  // a plain click.
  //
  // A plain click is an "arranger" gesture, not a "library" one — unlike
  // Shelf/LORE browser tiles (which aren't placed yet and preview via an
  // isolated Web Audio loop), these rifffs are already part of the actual
  // arrangement, so clicking one (with no modifier) jumps the REAL
  // transport to its position and plays from there, same as clicking a
  // spot on the Ruler, and collapses any active batch selection back down
  // to just that one tile. Real bug this fixed: starting an isolated
  // preview also paused the main transport underneath it, so clicking a
  // tile while playing silently cut the arrangement's audio — looked
  // exactly like "play isn't working."
  function handleTileClick(e: React.MouseEvent, rifff: Rifff): void {
    if (e.shiftKey && state.sel) {
      const anchorIndex = sequence.findIndex((r) => r.groupId === state.sel)
      const clickedIndex = sequence.findIndex((r) => r.groupId === rifff.groupId)
      if (anchorIndex === -1 || clickedIndex === -1) {
        setMultiSelected(new Set([rifff.groupId]))
        return
      }
      const [start, end] =
        anchorIndex < clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex]
      setMultiSelected(new Set(sequence.slice(start, end + 1).map((r) => r.groupId)))
      return
    }
    if (e.metaKey || e.ctrlKey) {
      setMultiSelected((prev) => {
        const next = new Set(prev)
        if (next.has(rifff.groupId)) next.delete(rifff.groupId)
        else next.add(rifff.groupId)
        return next
      })
      return
    }
    setMultiSelected(new Set())
    dispatch({ type: 'SELECT', groupId: rifff.groupId })
    const targetPos = rifff.startBar ?? 0
    dispatch({ type: 'SET_POS', pos: targetPos })
    if (playing) {
      void window.rifffApi.engineSetPosition(targetPos)
    } else {
      dispatch({ type: 'PLAY' })
    }
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

        // Places (or, if already placed elsewhere, pastes an independent
        // copy of) a single shelf-sourced rifff and returns the groupId it
        // ends up with — shared by both the single- and multi-select drop
        // branches below so there's exactly one place that knows "place if
        // unplaced, else paste a copy."
        function placeShelfRifff(shelfSourceId: string): string | null {
          const source = state.rifffs[shelfSourceId]
          if (!source) return null
          if (source.startBar === undefined) {
            // Not yet placed anywhere — place it (startBar here is
            // immediately overwritten by the SEQUENCE_RIFFFS dispatch the
            // caller issues right after; PLACE_ON_TIMELINE just needs a
            // value, 0 is fine).
            dispatch({ type: 'PLACE_ON_TIMELINE', groupId: shelfSourceId, startBar: 0 })
            return shelfSourceId
          }
          // Already placed elsewhere (e.g. dragged from the shelf a second
          // time) — an independent copy, same convention as the normal
          // Timeline's own shelf-drop handling.
          const action = pasteRifffAction(state, shelfSourceId, 0)
          if (!action || action.type !== 'PASTE_RIFFF') return null
          dispatch(action)
          return action.rifff.groupId
        }

        const shelfSourceIdsJson = e.dataTransfer.getData('text/rifff-shelf-source-ids')
        if (shelfSourceIdsJson) {
          let shelfSourceIds: unknown
          try {
            shelfSourceIds = JSON.parse(shelfSourceIdsJson)
          } catch {
            return
          }
          if (!Array.isArray(shelfSourceIds)) return
          const groupIds = sequence.map((r) => r.groupId)
          const placedIds = shelfSourceIds
            .filter((id): id is string => typeof id === 'string')
            .map(placeShelfRifff)
            .filter((id): id is string => id !== null)
          groupIds.splice(index, 0, ...placedIds)
          dispatch({ type: 'SEQUENCE_RIFFFS', groupIds })
          return
        }

        const shelfSourceId = e.dataTransfer.getData('text/rifff-shelf-source-id')
        if (shelfSourceId) {
          const groupIds = sequence.map((r) => r.groupId)
          const placedId = placeShelfRifff(shelfSourceId)
          if (placedId === null) return
          groupIds.splice(index, 0, placedId)
          dispatch({ type: 'SEQUENCE_RIFFFS', groupIds })
          return
        }

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
        const batchSelected = multiSelected.has(rifff.groupId)
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
            onClick={(e) => handleTileClick(e, rifff)}
            onContextMenu={(e) => {
              e.preventDefault()
              removeTiles(batchSelected ? multiSelected : new Set([rifff.groupId]))
              setMultiSelected(new Set())
            }}
            title={`${rifff.name} — shift/cmd-click to multi-select`}
            style={{
              order: index * 10,
              position: 'relative',
              width: TILE_SIZE,
              height: TILE_SIZE,
              cursor: 'pointer',
              border: batchSelected ? '1px solid var(--ra-stretch-on)' : '1px solid transparent',
              boxSizing: 'border-box',
              opacity: state.sel === rifff.groupId || batchSelected ? 1 : 0.85
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
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={5}
                  fill="var(--ra-text)"
                  stroke="#000"
                  strokeWidth={1.5}
                />
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
