import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState, useDispatch, usePlaying, usePos } from '../state/StoreContext'
import { placedRifffsInOrder, pasteRifffAction } from '../state/selectors'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { startPointerDrag } from './dragUtils'
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
  // Set (only) when a real drag of the scrub dot just ended — see
  // handleTileClick's own doc comment for why the tile's click handler
  // needs to check this.
  const suppressNextTileClickRef = useRef(false)
  // Right-click's "adjust length" popup — at most one open at a time, keyed
  // by which tile it's for plus where to draw it (the click position).
  const [barsMenuFor, setBarsMenuFor] = useState<{ groupId: string; x: number; y: number } | null>(
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
      if (playing) void window.rifffApi.engineSetPosition(bar)
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

        return (
          <div
            key={rifff.groupId}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/rifff-group-id', rifff.groupId)}
            onClick={(e) => handleTileClick(e, rifff)}
            onContextMenu={(e) => {
              e.preventDefault()
              if (e.metaKey || e.ctrlKey) {
                dispatch({ type: 'SOLO_GROUP', groupId: rifff.groupId })
                return
              }
              setBarsMenuFor({ groupId: rifff.groupId, x: e.clientX, y: e.clientY })
            }}
            title={`${rifff.name} — shift/cmd-click to multi-select · right-click to adjust length · cmd/ctrl+right-click to solo`}
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
                color: '#fff',
                pointerEvents: 'none'
              }}
            >
              {bars}
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
      {sequence.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)', padding: '8px 0' }}>
          drag rifffs in from the shelf or LORE library to start a sketch
        </div>
      )}
      {barsMenuFor &&
        (() => {
          const rifff = state.rifffs[barsMenuFor.groupId]
          if (!rifff) return null
          return (
            <SketchTileBarsMenu
              x={barsMenuFor.x}
              y={barsMenuFor.y}
              name={rifff.name}
              currentBars={effectiveBars(rifff)}
              naturalBars={rifff.barLength}
              bpm={state.bpm}
              onApply={(bars) => {
                dispatch({ type: 'SET_PLAYED_BARS', key: rifff.groupId, bars })
                // Re-packs every OTHER tile's startBar against the new
                // length — SET_PLAYED_BARS alone only updates this one
                // tile's own trim, it doesn't ripple the shift through the
                // rest of the sequence.
                dispatch({ type: 'SEQUENCE_RIFFFS', groupIds: sequence.map((r) => r.groupId) })
                setBarsMenuFor(null)
              }}
              onRemove={() => {
                removeTiles(new Set([rifff.groupId]))
                setBarsMenuFor(null)
              }}
              onClose={() => setBarsMenuFor(null)}
            />
          )
        })()}
    </div>
  )
}

/** How long `bars` bars actually take to play at `bpm`, in seconds — assumes
 * 4/4 (this app's only supported time signature; see totalBeats = barLength
 * * 4 elsewhere, e.g. BeatPicker) and PROJECT tempo, not the rifff's own
 * native bpm: sketch mode always forces stretch on (see SEQUENCE_RIFFFS), so
 * project tempo is what it actually plays back at. */
function secondsForBars(bars: number, bpm: number): number {
  return bars * (60 / bpm) * 4
}

/** Every whole-bar option the dropdown offers, ascending — always at least
 * 1..64 bars, extended further only if this particular rifff's own natural
 * length is longer than that (so its full, untrimmed length is always
 * reachable even for an unusually long rifff). */
function barOptions(naturalBars: number): number[] {
  const max = Math.max(64, Math.ceil(naturalBars))
  const options: number[] = []
  for (let b = 1; b <= max; b++) options.push(b)
  return options
}

/** Right-click popup for setting how many WHOLE bars a sketch tile plays
 * before the sequence advances — reuses the normal arranger's playedBars
 * resize mechanism (see effectiveBars/SEQUENCE_RIFFFS's own doc comments)
 * rather than a drag handle, since these tiles are small fixed-size glyphs
 * with no edge to grab. A plain dropdown (not a free-form number field) so
 * there's no way to land on a fractional bar count, and picking is a single
 * click. Mirrors ContextMenu's own dismiss-on-outside-click/Escape pattern
 * directly (rather than reusing that component) since it needs a select in
 * the body, which ContextMenu's plain items-list API doesn't support. */
function SketchTileBarsMenu({
  x,
  y,
  name,
  currentBars,
  naturalBars,
  bpm,
  onApply,
  onRemove,
  onClose
}: {
  x: number
  y: number
  name: string
  currentBars: number
  naturalBars: number
  bpm: number
  onApply: (bars: number) => void
  onRemove: () => void
  onClose: () => void
}): React.JSX.Element {
  const selectRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    selectRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleDismiss(): void {
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    // Registered on the next tick, not immediately — same reasoning as
    // ContextMenu's own identical setTimeout: the contextmenu event that
    // opens this is followed by a synthesized 'click' in some environments,
    // which would otherwise dismiss the menu the instant it opens.
    const id = setTimeout(() => {
      window.addEventListener('click', handleDismiss)
      window.addEventListener('contextmenu', handleDismiss)
    }, 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss)
      window.removeEventListener('contextmenu', handleDismiss)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 20,
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        borderRadius: 0,
        padding: 10,
        minWidth: 200,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--ra-text-3)',
          marginBottom: 6,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {name}
      </div>
      <select
        ref={selectRef}
        value={currentBars}
        onChange={(e) => onApply(Number(e.target.value))}
        style={{
          width: '100%',
          fontSize: 12,
          padding: '4px 6px',
          background: 'var(--ra-bg-row)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          color: 'var(--ra-text)'
        }}
      >
        {barOptions(naturalBars).map((bars) => (
          <option key={bars} value={bars}>
            {bars} {bars === 1 ? 'bar' : 'bars'} — {secondsForBars(bars, bpm).toFixed(1)}s
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', marginTop: 8 }}>
        <button
          onClick={onRemove}
          style={{
            flex: 1,
            height: 22,
            fontSize: 10,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-mute-on)',
            borderRadius: 0,
            cursor: 'pointer'
          }}
        >
          remove
        </button>
      </div>
    </div>
  )
}
