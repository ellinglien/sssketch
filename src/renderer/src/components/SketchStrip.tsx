import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { placedRifffsInOrder, pasteRifffAction } from '../state/selectors'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { startPointerDrag, suppressNextSyntheticClick } from './dragUtils'
import { markManualSeek } from '../state/manualSeek'
import type { Rifff } from '@shared/types'

export const TILE_SIZE = 64
export const TILE_GAP = 10

// Vertical pixels of right-click-drag movement per step through a tile's
// bar-length option list (see handleBarsMouseDown) — small enough that the
// whole short preset list is reachable within a comfortable drag distance.
const BARS_DRAG_PX_PER_STEP = 20

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
  // Set (only) when a real drag of the scrub dot just ended — see
  // handleTileClick's own doc comment for why the tile's click handler
  // needs to check this.
  const suppressNextTileClickRef = useRef(false)
  // Live preview while right-click-dragging a tile's bar-length (see
  // handleBarsMouseDown) — the committed value doesn't change until
  // release, but the tile's own label shows the candidate value as you drag,
  // same "preview locally, commit on release" convention as the normal
  // arranger's own resize-drag state (e.g. CollapsedRifffRow's dragPlayedBars).
  const [dragBarsFor, setDragBarsFor] = useState<{ groupIds: Set<string>; bars: number } | null>(
    null
  )

  // How many bars THIS tile actually plays before the sequence advances to
  // the next one — state.playedBars[groupId] when the right-click "adjust
  // length" menu has set a trim/extend, else the rifff's own natural length.
  // Every sketch-eligible rifff is linked (see isSketchEligible), so this
  // direct groupId lookup is always the right key — same reasoning as
  // SEQUENCE_RIFFFS's own identical lookup in store.ts.
  function effectiveBars(rifff: Rifff): number {
    return state.playedBars[rifff.groupId] ?? rifff.barLength
  }

  // Nearest gap between tiles, by clientX/clientY — tiles are uniform width
  // + a fixed gap, so this is direct arithmetic against the container's own
  // top-left corner rather than needing per-tile getBoundingClientRect
  // calls. The container wraps tiles onto multiple rows once they overflow
  // its width (flexWrap:'wrap', below), so this has to account for that —
  // an earlier version only ever looked at clientX, treating every row as a
  // continuation of row 1's own column count, which meant landing anywhere
  // in row 2 required dragging far enough right to satisfy row 1's full
  // width first. itemsPerRow re-derives how many tiles the container's
  // CURRENT width actually fits per row (flex-wrap doesn't expose that
  // number directly), matching the same padding/gap the container's own
  // style below uses.
  function insertionIndexForClientPoint(clientX: number, clientY: number): number {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return sequence.length
    const slot = TILE_SIZE + TILE_GAP
    const padding = 24
    const itemsPerRow = Math.max(1, Math.floor((rect.width - padding * 2 + TILE_GAP) / slot))
    const relativeX = clientX - rect.left - padding
    const relativeY = clientY - rect.top - padding
    const row = Math.max(0, Math.floor(relativeY / slot))
    const col = Math.max(0, Math.min(itemsPerRow, Math.round(relativeX / slot)))
    return Math.max(0, Math.min(sequence.length, row * itemsPerRow + col))
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
  //
  // Also guards against a real bug the scrub dot's drag introduced: the
  // dot's hit-circle sits INSIDE this tile, and stopPropagation on its own
  // mousedown (see handleScrubDotMouseDown/dragUtils) only stops that one
  // event from bubbling — it does nothing about the separate, later `click`
  // event the browser still synthesizes on mouseup. Without this guard,
  // releasing a drag on the dot also fired this handler, jumping playback
  // back to the rifff's own start (or, while paused, starting playback from
  // there unexpectedly) right as you let go.
  function handleTileClick(e: React.MouseEvent, rifff: Rifff): void {
    if (suppressNextTileClickRef.current) {
      suppressNextTileClickRef.current = false
      return
    }
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
    // Already the one playing — just select it, don't yank the transport
    // back to its start. Real bug this fixed: clicking the currently-playing
    // tile (e.g. to select it before right-clicking, or just to confirm
    // what's selected) restarted it from beat 1 instead of leaving playback
    // alone, which read as "my click broke the loop."
    if (playing && pos >= targetPos && pos < targetPos + effectiveBars(rifff)) return
    dispatch({ type: 'SET_POS', pos: targetPos })
    if (playing) {
      markManualSeek()
      void window.rifffApi.engineSetPosition(targetPos)
    } else {
      dispatch({ type: 'PLAY' })
    }
  }

  // Dragging the orbiting dot scrubs the playhead within its own rifff's
  // play window — angle around the tile's center maps to fraction-through,
  // the inverse of how dotX/dotY are computed below (12 o'clock = start,
  // clockwise = forward). Absolute mouse position is reconstructed each move
  // from startClientX/Y + the cumulative delta startPointerDrag reports,
  // since the angle needs the mouse's live position relative to a center
  // point fixed at drag start, not an incremental step. ownerSVGElement's
  // own rect is used for that center (not the tiny circle's own bounding
  // box) — it's sized/positioned to exactly match the tile underneath.
  function handleScrubDotMouseDown(
    e: React.MouseEvent<SVGCircleElement>,
    rifff: Rifff,
    start: number
  ): void {
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const startClientX = e.clientX
    const startClientY = e.clientY
    const bars = effectiveBars(rifff)

    function seekToClientPoint(clientX: number, clientY: number): void {
      const angleRad = Math.atan2(clientY - centerY, clientX - centerX)
      // Same inverse as dotX/dotY's own `angleRad = fraction * 2*PI - PI/2`,
      // wrapped into [0, 1) since atan2 returns [-PI, PI] — a raw fraction
      // here can land slightly negative depending on which side of 12
      // o'clock the angle falls on.
      const rawFraction = (angleRad + Math.PI / 2) / (2 * Math.PI)
      const fraction = ((rawFraction % 1) + 1) % 1
      const bar = start + fraction * bars
      dispatch({ type: 'SET_POS', pos: bar })
      if (playing) {
        markManualSeek()
        void window.rifffApi.engineSetPosition(bar)
      }
    }

    seekToClientPoint(startClientX, startClientY)
    startPointerDrag(
      e,
      (deltaX, deltaY) => {
        seekToClientPoint(startClientX + deltaX, startClientY + deltaY)
      },
      (moved) => {
        if (moved) suppressNextTileClickRef.current = true
      }
    )
  }

  // Right-click-drag sets how many bars this tile plays before the sequence
  // advances — replaces an earlier click-to-open-a-list popup, which felt
  // like more UI than this deserved. Dragging steps through the SAME short
  // preset list barOptions() already offers (1/2/3/4/6/8/12/16 plus this rifff's
  // own natural/current length) rather than a fine linear ramp, since that
  // list is already the deliberately-small "don't overwhelm" set. Committed
  // only on release (see effectiveBars/dragBarsFor's own doc comment) —
  // right-click-drag without releasing on THIS tile, or a plain right-click
  // with no drag at all, changes nothing.
  function handleBarsMouseDown(e: React.MouseEvent, rifff: Rifff): void {
    if (e.button !== 2) return
    if (e.ctrlKey) {
      dispatch({ type: 'SOLO_GROUP', groupId: rifff.groupId })
      return
    }
    const startBars = effectiveBars(rifff)
    const options = barOptions(rifff.barLength, startBars)
    const startIndex = options.indexOf(startBars)
    // Dragging a tile that's part of an active multi-selection applies the
    // resulting bar count to every selected tile, not just the one under the
    // cursor — same "act on the whole batch" convention multi-select already
    // has elsewhere in this component (delete, drag-out).
    const targetGroupIds =
      multiSelected.size > 1 && multiSelected.has(rifff.groupId)
        ? multiSelected
        : new Set([rifff.groupId])
    let finalBars = startBars
    startPointerDrag(
      e,
      (_deltaX, deltaY) => {
        // Drag UP increases (screen Y decreases upward), matching a
        // fader/knob's usual sense — DRAG_PX_PER_STEP of vertical movement
        // moves exactly one step through the option list.
        const stepsMoved = Math.round(-deltaY / BARS_DRAG_PX_PER_STEP)
        const newIndex = Math.max(0, Math.min(options.length - 1, startIndex + stepsMoved))
        finalBars = options[newIndex]
        setDragBarsFor({ groupIds: targetGroupIds, bars: finalBars })
      },
      (moved) => {
        setDragBarsFor(null)
        if (moved && finalBars !== startBars) {
          for (const groupId of targetGroupIds) {
            dispatch({ type: 'SET_PLAYED_BARS', key: groupId, bars: finalBars })
          }
          // Re-packs every OTHER tile's startBar against the new length(s) —
          // SET_PLAYED_BARS alone only updates each tile's own trim, it
          // doesn't ripple the shift through the rest of the sequence.
          dispatch({ type: 'SEQUENCE_RIFFFS', groupIds: sequence.map((r) => r.groupId) })
        }
      }
    )
  }

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => {
        e.preventDefault()
        setDropIndex(insertionIndexForClientPoint(e.clientX, e.clientY))
      }}
      onDragLeave={() => setDropIndex(null)}
      onDrop={(e) => {
        e.preventDefault()
        const index = insertionIndexForClientPoint(e.clientX, e.clientY)
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
        const bars = effectiveBars(rifff)
        const isCurrent = playing && pos >= start && pos < start + bars
        const batchSelected = multiSelected.has(rifff.groupId)
        // 0..1 progress through this rifff's own play window — only
        // meaningful while isCurrent, but harmless to compute either way.
        const fraction = (pos - start) / bars
        const angleRad = fraction * 2 * Math.PI - Math.PI / 2 // start at 12 o'clock
        const orbitRadius = 46 // just outside PolarGlyph's own outermost ring
        const dotX = 50 + orbitRadius * Math.cos(angleRad)
        const dotY = 50 + orbitRadius * Math.sin(angleRad)
        const isDraggingBars = !!dragBarsFor?.groupIds.has(rifff.groupId)
        const displayBars = dragBarsFor?.groupIds.has(rifff.groupId) ? dragBarsFor.bars : bars

        return (
          <div
            key={rifff.groupId}
            draggable
            onDragStart={(e) => {
              suppressNextSyntheticClick()
              e.dataTransfer.setData('text/rifff-group-id', rifff.groupId)
            }}
            onClick={(e) => handleTileClick(e, rifff)}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => handleBarsMouseDown(e, rifff)}
            title={`${rifff.name} — shift/cmd-click to multi-select · right-click and drag to adjust length · ctrl+right-click to solo`}
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
            {/* How many bars this tile plays before the sequence advances —
                always shown, not just when trimmed, so the whole sketch's
                pacing is readable at a glance. */}
            <span
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 14,
                fontWeight: 700,
                color: isDraggingBars ? 'var(--ra-stretch-on)' : '#fff',
                pointerEvents: 'none'
              }}
            >
              {displayBars}
            </span>
            {isCurrent && (
              <svg
                width={TILE_SIZE}
                height={TILE_SIZE}
                viewBox="0 0 100 100"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                {/* Larger invisible hit target sharing the dot's own center —
                    the visible dot (r=5, ~3px on screen at TILE_SIZE=64) is
                    too small to reliably grab on its own. Drawn first so the
                    visible dot stays on top and unaffected visually. */}
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={14}
                  fill="transparent"
                  style={{ pointerEvents: 'auto', cursor: 'grab' }}
                  onMouseDown={(e) => handleScrubDotMouseDown(e, rifff, start)}
                >
                  <title>drag to scrub within this rifff</title>
                </circle>
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={5}
                  fill="var(--ra-text)"
                  stroke="#000"
                  strokeWidth={1.5}
                  style={{ pointerEvents: 'none' }}
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
    </div>
  )
}

/** A short, deliberately limited set of common bar counts (powers of two,
 * plus 3/6/12 for triplet-feel and 3/4-derived phrase lengths that a
 * pure power-of-two list can't reach) — every full option-by-option list
 * (1..64) felt overwhelming for what's usually a quick "make it
 * shorter/longer" choice. The rifff's own natural (untrimmed) length and
 * whatever it's currently set to are always folded in too, even when
 * neither is one of these presets, so neither ever silently disappears
 * from the list just because it isn't one of the presets. */
function barOptions(naturalBars: number, currentBars: number): number[] {
  const options = new Set([1, 2, 3, 4, 6, 8, 12, 16])
  options.add(Math.max(1, Math.round(naturalBars)))
  options.add(Math.max(1, Math.round(currentBars)))
  return [...options].sort((a, b) => a - b)
}
