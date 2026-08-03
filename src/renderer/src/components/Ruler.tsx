import { useDispatch, usePlaying } from '../state/StoreContext'
import { startPointerDrag } from './dragUtils'
import { useFrameScale, toLogicalX } from '../state/FrameScaleContext'
import { markManualSeek } from '../state/manualSeek'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { LoopRegion } from '../state/store'

const PPB = 24

export function Ruler({
  bars: barCount,
  ppb = PPB,
  loopRegion,
  onSetLoopRegion
}: {
  bars: number
  ppb?: number
  /** The current loop-recording region, in bars — null if none is set yet.
   * See docs/superpowers/specs/2026-08-03-loop-recording-design.md. */
  loopRegion: LoopRegion
  onSetLoopRegion: (region: LoopRegion) => void
}): React.JSX.Element {
  const dispatch = useDispatch()
  const playing = usePlaying()
  const frameScale = useFrameScale()
  const bars = Array.from({ length: barCount }, (_, i) => i + 1)

  // Click or drag along the ruler to scrub the playhead — free (unsnapped)
  // positioning, matching how pos already moves as a continuous float
  // during playback rather than being bar-quantized. While playing, also
  // seeks the live engine transport immediately rather than waiting for the
  // next 30Hz position tick to catch up; while stopped, updating pos alone
  // is enough since enginePlay(pos) reads it fresh at play-start (see
  // StoreContext.tsx).
  function seekTo(pos: number): void {
    const clamped = Math.max(0, Math.min(barCount, pos))
    dispatch({ type: 'SET_POS', pos: clamped })
    if (playing) {
      markManualSeek()
      void window.rifffApi.engineSetPosition(clamped)
    }
  }

  function handleScrubStart(e: React.MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect()
    // getBoundingClientRect()/clientX/startPointerDrag's deltaX all report
    // real screen pixels, but ppb is defined in logical, pre-scale pixels --
    // see FrameScaleContext's own doc comment. Without dividing out
    // frameScale first, both the initial click and the continued drag
    // silently drift off target the moment the window isn't at its default
    // size.
    const startBar = Math.max(0, toLogicalX(e.clientX - rect.left, frameScale) / ppb)
    seekTo(startBar)
    startPointerDrag(e, (deltaX) => {
      seekTo(startBar + toLogicalX(deltaX, frameScale) / ppb)
    })
  }

  // Sweeps out a brand new loop region from a plain click-drag on the
  // ruler's own background (not on an existing region's edge handles,
  // which have their own onMouseDown below and stop propagation so this
  // handler never also fires underneath them). Mirrors handleScrubStart's
  // own real-pixel-to-bar conversion exactly, including the frameScale
  // correction -- see its own comment for why that matters.
  function handleLoopDragStart(e: ReactMouseEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const startBar = Math.max(0, toLogicalX(e.clientX - rect.left, frameScale) / ppb)
    let dragEndBar = startBar
    startPointerDrag(e, (deltaX) => {
      dragEndBar = Math.max(0, startBar + toLogicalX(deltaX, frameScale) / ppb)
      const lo = Math.min(startBar, dragEndBar)
      const hi = Math.max(startBar, dragEndBar)
      onSetLoopRegion({ startBar: lo, endBar: hi })
    })
  }

  // Dragging either edge of an already-set region adjusts just that edge --
  // standard DAW loop-brace behavior (Ableton/Logic/Cubase all work this
  // way). `edge`'s own fixed endpoint (the one NOT being dragged) stays
  // put; the dragged edge tracks the cursor, swapping which one is
  // "startBar" vs "endBar" if the user drags one edge past the other.
  function handleLoopEdgeDragStart(
    e: ReactMouseEvent<HTMLDivElement>,
    edge: 'start' | 'end'
  ): void {
    e.stopPropagation()
    if (!loopRegion) return
    const fixedBar = edge === 'start' ? loopRegion.endBar : loopRegion.startBar
    const draggedStartBar = edge === 'start' ? loopRegion.startBar : loopRegion.endBar
    startPointerDrag(e, (deltaX) => {
      const draggedBar = Math.max(0, draggedStartBar + toLogicalX(deltaX, frameScale) / ppb)
      const lo = Math.min(fixedBar, draggedBar)
      const hi = Math.max(fixedBar, draggedBar)
      onSetLoopRegion({ startBar: lo, endBar: hi })
    })
  }

  return (
    <div
      onMouseDown={(e) => {
        // Only start a fresh loop-region drag on a plain click (no
        // modifier) -- Cmd is already the hand-pan modifier elsewhere in
        // this app (App.tsx), and this ruler has no pan behavior of its
        // own to conflict with, but keeping the same "plain click only"
        // discipline here avoids ever having to disambiguate the two later.
        if (!e.metaKey) handleLoopDragStart(e)
        handleScrubStart(e)
      }}
      title="click or drag to scrub"
      style={{
        height: 24,
        background: 'var(--ra-bg-rail)',
        borderBottom: '1px solid var(--ra-border)',
        display: 'flex',
        cursor: 'pointer'
      }}
    >
      <div style={{ position: 'relative', width: barCount * ppb }}>
        {bars.map((bar) => (
          <div
            key={bar}
            style={{
              position: 'absolute',
              left: (bar - 1) * ppb,
              top: 0,
              bottom: 0,
              borderLeft: `1px solid ${(bar - 1) % 4 === 0 ? 'var(--ra-border)' : 'var(--ra-grid-minor)'}`
            }}
          >
            {(bar - 1) % 8 === 0 && (
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)', paddingLeft: 3 }}>{bar}</span>
            )}
          </div>
        ))}
        {/* Loop-recording region bracket -- tinted fill + accent border,
            using the same --ra-type-audio-in red already used for the
            playhead/mute so this reads as "recording/input" without a new
            token (see the design doc's own color rationale). Edge handles
            are small hit zones straddling each boundary (6px wide,
            centered on the edge via left offset), wide enough to grab
            without the same "hit target too small" problem the fade
            dots/resize handles had earlier this session. */}
        {loopRegion && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              height: 24,
              left: loopRegion.startBar * ppb,
              width: (loopRegion.endBar - loopRegion.startBar) * ppb,
              background: 'color-mix(in srgb, var(--ra-type-audio-in) 10%, transparent)',
              borderTop: '2px solid var(--ra-type-audio-in)',
              borderLeft: '2px solid var(--ra-type-audio-in)',
              borderRight: '2px solid var(--ra-type-audio-in)',
              pointerEvents: 'none'
            }}
          >
            <div
              onMouseDown={(e) => handleLoopEdgeDragStart(e, 'start')}
              title="drag to move loop start"
              style={{
                position: 'absolute',
                left: -3,
                top: 0,
                width: 6,
                height: 24,
                cursor: 'ew-resize',
                pointerEvents: 'auto'
              }}
            />
            <div
              onMouseDown={(e) => handleLoopEdgeDragStart(e, 'end')}
              title="drag to move loop end"
              style={{
                position: 'absolute',
                right: -3,
                top: 0,
                width: 6,
                height: 24,
                cursor: 'ew-resize',
                pointerEvents: 'auto'
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export { PPB }
