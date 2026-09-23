import { useEffect, useRef, useState } from 'react'
import { MIN_DRAWN_RISER_LENGTH_BARS, riserDragExtent } from '@shared/riser'
import { startPointerDrag, suppressNextSyntheticClick } from './dragUtils'
import { NAME_BAR_HEIGHT } from './RifffBlockRow'
import { ROW_HEIGHT } from './StemWaveformRow'
import { useZoom } from '../state/StoreContext'

/** The vertical footprint a riser row is about to have, used for the preview
 * on a riser being put on a BRAND NEW row -- where there is, by definition,
 * no row on screen yet to measure. Exactly RiserBlock's own name bar plus
 * lane stack, so the rectangle drawn during the drag is the size of the
 * thing that lands. */
const NEW_ROW_PREVIEW_HEIGHT = NAME_BAR_HEIGHT + ROW_HEIGHT

/** Below this the "n bars" readout is dropped from the preview -- the same
 * "a narrow thing keeps its shape, not its labels" rule AutomationLane's own
 * corner cluster follows. */
const READOUT_MIN_WIDTH_PX = 44

/** What the gesture is currently describing: the riser's extent in bars, plus
 * the vertical band it will occupy, measured once at press time. */
interface RiserExtentDraft {
  startBar: number
  lengthBars: number
  top: number
  height: number
}

/**
 * The armed half of creating a riser: a transparent surface over the whole
 * arranger that turns one drag into a riser's START and LENGTH, drawing the
 * extent as it goes.
 *
 * This exists because of a direct report (Elling, 2026-09-23): "the flow for
 * creating a riser needs some help though... the initial sizing is what needs
 * work... prompt the user to select the width first, then draw the line."
 * Picking "add riser here" used to drop a fixed four-bar riser that then had
 * to be resized; now the menu item ARMS this, and the drag that follows is
 * where the riser's extent is chosen.
 *
 * Three things are decided before this component ever mounts, and that is
 * what keeps it simple:
 * - WHICH ROW, from the right-click that armed it (an existing row's
 *   `data-channel-id`, or a fresh id for a row of its own). So the drag is
 *   purely horizontal: moving the cursor up or down during it changes
 *   nothing, and releasing above or below the row still lands the riser on
 *   the armed one rather than cancelling. There is no vertical decision left
 *   to get wrong.
 * - WHAT IT SOUNDS LIKE, from RISER_DEFAULTS, which createRiser applies. A
 *   user happy with the default sweep is finished at release.
 * - HOW A NON-DRAG RESOLVES, in @shared/riser's riserDragExtent -- a press
 *   that never covered a whole bar creates the default-length riser the menu
 *   item used to create on its own, so a click still does something and the
 *   gesture cannot produce a zero-length riser. See that function's own doc
 *   comment for why that beat "create nothing".
 *
 * Backing out: Escape at any point, or a secondary-button press on the
 * surface. Both leave the project completely untouched -- nothing is
 * dispatched until release, and the channel id minted for a new row is just
 * a string until an ADD_RISER carries it, so an abandoned gesture cannot
 * leave an empty row behind either.
 *
 * The one case this cannot cover is a release that happens outside the app
 * window entirely, where no mouseup is delivered; that is true of every drag
 * in this app (see startPointerDrag) and is not special here -- the surface
 * stays armed, and Escape still clears it.
 */
export function RiserExtentGesture({
  channelId,
  isNewRow,
  onCancel,
  onCreate
}: {
  /** The row the riser will land on. Already exists on screen unless
   * `isNewRow`. */
  channelId: string
  /** True when the right-click landed below the last row, i.e. the riser is
   * getting a row of its own that does not exist yet. */
  isNewRow: boolean
  onCancel: () => void
  /** Release. Both numbers are whole bars, and `lengthBars` is never zero. */
  onCreate: (startBar: number, lengthBars: number) => void
}): React.JSX.Element {
  const ppb = useZoom()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<RiserExtentDraft | null>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  /** The vertical band the preview is drawn in, in this surface's own
   * coordinates. An existing row is MEASURED (rows vary in height -- a
   * recording channel's button stack sets a taller minimum, and a row with
   * several clips on it is taller again), so the preview covers exactly the
   * row the riser is going to. A row that does not exist yet gets a
   * riser-sized band starting at the pointer, which is where the new row
   * appears. */
  function bandFor(e: React.MouseEvent, surfaceTop: number): { top: number; height: number } {
    const row = isNewRow
      ? null
      : surfaceRef.current
          ?.closest('[data-timeline]')
          ?.querySelector(`[data-channel-id="${CSS.escape(channelId)}"]`)
    const rowRect = row?.getBoundingClientRect()
    if (!rowRect) {
      return { top: e.clientY - surfaceTop, height: NEW_ROW_PREVIEW_HEIGHT }
    }
    return { top: rowRect.top - surfaceTop, height: rowRect.height }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>): void {
    // A secondary press backs out. The `contextmenu` that follows it arrives
    // after this surface has already unmounted, so it reaches the arranger
    // underneath and re-opens the same menu the gesture was armed from --
    // which is the right outcome rather than an accident: right-click got
    // you here, and right-click puts the menu back.
    if (e.button !== 0) {
      onCancel()
      return
    }
    const surfaceRect = surfaceRef.current?.getBoundingClientRect()
    if (!surfaceRect) return
    const anchorBar = (e.clientX - surfaceRect.left) / ppb
    const band = bandFor(e, surfaceRect.top)
    // A plain closure variable, read again in onEnd -- never a setState
    // updater, per dragUtils.ts's warning about StrictMode double-invoking
    // those. The same riserDragExtent call feeds the preview and the
    // creation, so what is drawn is what lands.
    let extent = riserDragExtent(anchorBar, anchorBar)
    setDraft({ ...extent, ...band })
    startPointerDrag(
      e,
      (deltaX) => {
        extent = riserDragExtent(anchorBar, anchorBar + deltaX / ppb)
        setDraft({ ...extent, ...band })
      },
      (moved) => {
        // startPointerDrag arms this itself for a real drag, but not for a
        // press that never moved -- and this surface unmounts the instant
        // the riser is created, so that press's trailing click would land on
        // the Timeline underneath and jump the playhead at the exact moment
        // the riser appears. A click here is a real outcome (the
        // default-length riser), not a stray, so it gets the same treatment.
        if (!moved) suppressNextSyntheticClick()
        setDraft(null)
        onCreate(extent.startBar, extent.lengthBars)
      }
    )
  }

  const previewWidthPx = draft ? Math.max(1, draft.lengthBars * ppb) : 0

  return (
    <div
      ref={surfaceRef}
      data-riser-extent-gesture
      onMouseDown={handleMouseDown}
      // A press that never moved still produces a trailing click, and every
      // row in the arranger sits inside Timeline's own click-to-scrub
      // background handler -- without this, drawing a riser would also jump
      // the playhead to wherever the mouse came up.
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 6,
        cursor: 'crosshair'
      }}
    >
      {draft && (
        <div
          style={{
            position: 'absolute',
            left: draft.startBar * ppb,
            top: draft.top,
            width: previewWidthPx,
            height: draft.height,
            // Dashed, per tokens.css's own note that --ra-border-strong is
            // what a dashed drop target is drawn in: this is the same kind
            // of thing, a shape that is not there yet.
            border: '1px dashed var(--ra-border-strong)',
            background: 'color-mix(in srgb, var(--ra-text) 6%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none'
          }}
        >
          {previewWidthPx >= READOUT_MIN_WIDTH_PX && (
            <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
              {draft.lengthBars === MIN_DRAWN_RISER_LENGTH_BARS
                ? '1 bar'
                : `${draft.lengthBars} bars`}
            </span>
          )}
        </div>
      )}
      <div
        style={{
          position: 'fixed',
          bottom: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 'var(--ra-z-anchored)',
          padding: '5px 10px',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          fontSize: 9,
          color: 'var(--ra-text-3)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap'
        }}
      >
        drag across the row to set where the riser starts and ends · esc to cancel
      </div>
    </div>
  )
}
