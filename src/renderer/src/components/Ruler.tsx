import { useDispatch, usePlaying } from '../state/StoreContext'
import { startPointerDrag } from './dragUtils'
import { useFrameScale, toLogicalX } from '../state/FrameScaleContext'
import { markManualSeek } from '../state/manualSeek'
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
  //
  // Falls back to a plain scrub if the mouse never actually moved (a bare
  // click, not a drag) -- startPointerDrag's onEnd(moved) tells us this.
  // Without that fallback, a plain click on the ruler (the single most
  // common way to jump the playhead somewhere) would silently do nothing
  // at all now that plain-drag's default meaning changed to "set loop
  // region" instead of "scrub."
  //
  // No upper clamp on the resulting bar (unlike seekTo's Math.min(barCount, ...))
  // -- deliberate, not an oversight: the loop region is independent of
  // barCount/loopLengthBars (the whole project's own length) and can
  // legitimately extend past it, per its own doc comment in store.ts.
  function handleLoopDragStart(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    // Whole-bar snap, matching App.tsx's own barForClientX (what a clip
    // drop snaps to) -- unlike handleScrubStart's deliberately free/
    // unsnapped positioning above, a loop region drawn to record into
    // should land on the same grid the rest of the arranger uses, not an
    // arbitrary sub-bar float.
    const startBar = Math.max(0, Math.round(toLogicalX(e.clientX - rect.left, frameScale) / ppb))
    startPointerDrag(
      e,
      (deltaX) => {
        const dragEndBar = Math.max(0, Math.round(startBar + toLogicalX(deltaX, frameScale) / ppb))
        const lo = Math.min(startBar, dragEndBar)
        const hi = Math.max(startBar, dragEndBar)
        onSetLoopRegion({ startBar: lo, endBar: hi })
      },
      (moved) => {
        if (!moved) seekTo(startBar)
      }
    )
  }

  // Dragging either edge of an already-set region adjusts just that edge --
  // standard DAW loop-brace behavior (Ableton/Logic/Cubase all work this
  // way). `edge`'s own fixed endpoint (the one NOT being dragged) stays
  // put; the dragged edge tracks the cursor, swapping which one is
  // "startBar" vs "endBar" if the user drags one edge past the other.
  //
  // Known limitation, not a bug: if the region is ever collapsed to zero
  // width (both edges at the same bar), both edge handles below end up at
  // the identical on-screen position, and the later-in-DOM-order one (the
  // "end" handle) wins every hit-test in the overlap -- there's no way to
  // grab "start" again until "end" is dragged back out to create some
  // separation. Not worth extra hit-testing complexity to fix pre-emptively
  // for an edge case that requires deliberately collapsing the region.
  function handleLoopEdgeDragStart(
    e: React.MouseEvent<HTMLDivElement>,
    edge: 'start' | 'end'
  ): void {
    e.stopPropagation()
    if (!loopRegion) return
    const fixedBar = edge === 'start' ? loopRegion.endBar : loopRegion.startBar
    const draggedStartBar = edge === 'start' ? loopRegion.startBar : loopRegion.endBar
    startPointerDrag(e, (deltaX) => {
      // Same whole-bar snap as handleLoopDragStart above.
      const draggedBar = Math.max(
        0,
        Math.round(draggedStartBar + toLogicalX(deltaX, frameScale) / ppb)
      )
      const lo = Math.min(fixedBar, draggedBar)
      const hi = Math.max(fixedBar, draggedBar)
      onSetLoopRegion({ startBar: lo, endBar: hi })
    })
  }

  return (
    <div
      onMouseDown={(e) => {
        // Cmd+drag scrubs (matching this app's existing "Cmd = the
        // special navigation/setup modifier" convention -- see App.tsx's
        // Cmd+drag timeline pan and Cmd+scroll zoom); a plain drag sets
        // the loop region instead. These must be mutually exclusive, not
        // both firing on the same mousedown -- an earlier version called
        // both handlers unconditionally, and since startPointerDrag
        // registers its own independent mousemove/mouseup listeners per
        // call with no shared mutex, that meant every plain drag was
        // simultaneously scrubbing the playhead AND sweeping a loop
        // region at once.
        if (e.metaKey) {
          handleScrubStart(e)
        } else {
          handleLoopDragStart(e)
        }
      }}
      title="click to scrub · drag to set loop region · cmd+drag to scrub"
      style={{
        position: 'sticky',
        top: 0,
        // Above ChannelRow's own sticky m/s/fx/r button stack (zIndex 5)
        // and the live capture overlay, so the ruler stays drawn on top
        // of channel content scrolling underneath it rather than getting
        // covered. Only a top offset is set (no left/right) -- App.tsx's
        // scroll container shares one element for both axes, so this
        // pins the ruler vertically while it still scrolls normally
        // WITH the timeline horizontally, keeping its bar ticks in sync
        // with the channels below exactly as before.
        zIndex: 10,
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
            using --ra-recording-live, this app's own loop-record feature
            color (see tokens.css's own doc comment) -- not
            --ra-type-audio-in, which is a generic SoundType color covering
            every audio-in-typed stem regardless of provenance, not
            specifically "recording." Edge handles are small hit zones
            straddling each boundary (6px wide, centered on the edge via
            left offset), wide enough to grab without the same "hit target
            too small" problem the fade dots/resize handles had earlier
            this session. */}
        {loopRegion && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              height: 24,
              left: loopRegion.startBar * ppb,
              width: (loopRegion.endBar - loopRegion.startBar) * ppb,
              background: 'color-mix(in srgb, var(--ra-recording-live) 10%, transparent)',
              borderTop: '2px solid var(--ra-recording-live)',
              borderLeft: '2px solid var(--ra-recording-live)',
              borderRight: '2px solid var(--ra-recording-live)',
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
