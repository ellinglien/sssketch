import { useEffect, useState } from 'react'
import {
  MIN_RISER_LENGTH_BARS,
  RISER_DEFAULTS,
  riserCutoffAt,
  riserEnvelopeAt
} from '@shared/riser'
import { AutomationLane } from './AutomationLane'
import { EditableText } from './EditableText'
import { RowGainDial } from './RowGainDial'
import { startPointerDrag } from './dragUtils'
import { ROW_HEIGHT } from './StemWaveformRow'
import { NAME_BAR_HEIGHT } from './RifffBlockRow'
import { useAppSelector, useDispatch, useZoom } from '../state/StoreContext'

/** How many points the sweep line and the swell wedge are drawn with. The
 * sweep can be an arbitrary hand-drawn curve, so it is SAMPLED rather than
 * read point by point -- which also means the block looks the same whether
 * the curve has two breakpoints or forty. 48 is finer than a riser is ever
 * drawn on screen at this app's zoom levels. */
const SHAPE_SAMPLES = 48

/** The diagonal hatch's spacing, in pixels. Deliberately coarse: this is a
 * texture that says "generated", not a fill. */
const HATCH_SPACING_PX = 7

/**
 * ONE placed noise riser, drawn on its own arranger row.
 *
 * It must NOT read as a stem. A stem block in this arranger is a waveform:
 * an image of audio that exists. A riser is audio that does not exist yet --
 * the engine makes it at render time from the handful of numbers this block
 * is showing (see @shared/riser). So it is drawn as a DIAGRAM rather than as
 * a picture:
 * - a diagonal hatch across the whole block, the one texture nothing else in
 *   this arranger uses, which is what makes it legible as generated at a
 *   glance and from across the timeline;
 * - the sweep itself as a line rising (or falling) across the block, sampled
 *   from the very same riserCutoffAt the engine evaluates, so the slope you
 *   see is the slope you hear;
 * - the swell as a faint wedge filling up underneath it, so "this gets louder
 *   towards the end" is visible without reading anything.
 *
 * All of it in --ra-text at low opacity. No colour at all: per tokens.css,
 * colour in this app is spent only on things carrying audio INFORMATION (a
 * stem's type, the playhead, mute/danger), and a riser is chrome-plus-shape,
 * not a stem with a sound type. Sharp corners throughout, lowercase label,
 * same as everything else here.
 *
 * That no-colour rule now covers the row's LABEL too: a clip's name bar is
 * tinted with its first stem's type colour (stemDisplayColorVar), and
 * typeColorVar's only legitimate input is a SoundType -- which a riser does
 * not have, and must not be given one just to have a hue. The name sits in
 * --ra-text-2. The only colour a riser row ever shows is the m button going
 * --ra-mute-on, which tokens.css sanctions as a state colour.
 *
 * The block is drawn to the riser's OWN end bar (startBar + lengthBars), not
 * to riserSoundingEndBar. The engine rings the riser on for RISER_TAIL_BARS
 * past that (see @shared/riser), and the two DAW exporters crop their clip at
 * the sounding end so the tail survives the trip -- but this rectangle is the
 * riser's FOOTPRINT, not its audio: it is the surface you grab to move it,
 * its two edge handles are the riser's two real edges, and its right edge is
 * the downbeat the swell peaks on, which is the whole point of where a riser
 * is placed. Drawing an eighth note of tail past that would put the handles
 * a fraction of a bar off the number a resize actually writes, and would
 * push the block over the drop it is building to. riserEndBar's own doc
 * comment already calls this out ("where the block is drawn" wants that one).
 *
 * Interaction matches a clip's as closely as a thing with no crop can: drag
 * the body to move it in time, drag either edge to resize (the left edge
 * moves the start and holds the end still, exactly like a clip's left handle
 * does), right-click for its own menu. The gesture/undo split is this
 * codebase's usual one -- a local preview for the whole drag, exactly one
 * dispatch on release, so a drag is one undo step (see
 * CollapsedRifffRow.tsx's own resize handlers, which this mirrors).
 */
export function RiserBlock({
  riserId,
  onOpenContextMenu,
  laneOpenInPlace,
  onCloseLane
}: {
  riserId: string
  /** Opens the app's own context menu for this riser -- the same callback
   * shape, and the same journey up through ChannelRow to App, that a clip's
   * menu already takes (onOpenClipMenu). Owning the menu's CONTENTS up there
   * rather than here is what keeps every right-click in the arranger looking
   * and behaving like one thing. */
  onOpenContextMenu: (x: number, y: number, riserId: string) => void
  /** THIS riser's sweep lane is open even though the app is not in
   * the transport bar's automation toggle -- true for the riser that was
   * just drawn, which opens
   * ready to draw on (see App.tsx's openRiserLaneId).
   *
   * A whole-app mode flip was considered for that and rejected: switching
   * the global mode because someone drew one riser puts every clip in the
   * project behind a lane and loses the user the place they were working
   * in. Nothing in the layout required it -- the lane is already a per-
   * element overlay (the per-clip lane spec, section 2b), so "one lane, in
   * place" is a smaller thing to ask for than the mode was. */
  laneOpenInPlace: boolean
  onCloseLane: () => void
}): React.JSX.Element | null {
  const dispatch = useDispatch()
  const ppb = useZoom()
  const riser = useAppSelector((s) => s.risers[riserId])
  const automationLanes = useAppSelector((s) => s.automationLanes)
  const [hovered, setHovered] = useState(false)

  // Escape closes a lane opened in place -- the same key that backs out of
  // the creation gesture that opened it, so one key gets you out of the
  // whole flow at any point in it. Only bound while such a lane is actually
  // open, so this adds no listener to the ordinary case. Nothing to do in
  // when the lanes are up app-wide: there the lane belongs to the transport
  // bar's automation toggle, and that toggle is how it closes.
  useEffect(() => {
    if (!laneOpenInPlace) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      onCloseLane()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [laneOpenInPlace, onCloseLane])

  // The in-progress geometry of a move/resize. Local state rather than
  // state.dragPlayedBars & friends: nothing outside this block needs to see a
  // half-finished drag (unlike a clip's volume, which the engine wants live),
  // and keeping it here means a drag costs no dispatches at all until it
  // lands.
  const [drag, setDrag] = useState<{ startBar: number; lengthBars: number } | null>(null)

  // Whether the name bar is currently a text field rather than a drag
  // surface. It is only ever one of the two -- see the name bar's own
  // comment for why renaming had to move to double-click.
  const [renaming, setRenaming] = useState(false)

  if (!riser) return null

  const startBar = drag?.startBar ?? riser.startBar
  const lengthBars = drag?.lengthBars ?? riser.lengthBars
  const leftPx = startBar * ppb
  const widthPx = Math.max(1, lengthBars * ppb)

  function beginMove(e: React.MouseEvent): void {
    if (e.button !== 0) return
    const originBar = riser.startBar
    let landing = originBar
    startPointerDrag(
      e,
      (deltaX) => {
        // Whole bars, like every other clip drag in this arranger. Option
        // (altKey) is NOT a fine-position modifier here the way it is in the
        // automation lane: a riser's job is to arrive exactly on a downbeat.
        landing = Math.max(0, originBar + Math.round(deltaX / ppb))
        setDrag({ startBar: landing, lengthBars: riser.lengthBars })
      },
      (moved) => {
        setDrag(null)
        if (moved) dispatch({ type: 'MOVE_RISER', id: riser.id, startBar: landing })
      }
    )
  }

  // Arrange-mode only, in practice: both edge handles live inside the block
  // body, which the automation lane covers whole (zIndex 4 over their 3), so
  // a riser cannot be resized while its lane is open. Stated rather than
  // silently left that way -- moving is what the lane was really blocking
  // (the name bar now handles it, see below), and a resize has no equally
  // obvious home outside the body. Revisit if it starts to bite.
  function beginResize(edge: 'start' | 'end', e: React.MouseEvent): void {
    if (e.button !== 0) return
    const originStart = riser.startBar
    const originLength = riser.lengthBars
    const originEnd = originStart + originLength
    let nextStart = originStart
    let nextLength = originLength
    startPointerDrag(
      e,
      (deltaX) => {
        const deltaBars = Math.round(deltaX / ppb)
        if (edge === 'end') {
          nextLength = Math.max(MIN_RISER_LENGTH_BARS, originLength + deltaBars)
          nextStart = originStart
        } else {
          // The left edge holds the END still, which is what a clip's own
          // left handle does (see CollapsedRifffRow's handleLeftResizeStart)
          // and what a riser wants most: the drop it builds into is fixed,
          // and the build is what gets longer or shorter.
          nextStart = Math.max(
            0,
            Math.min(originEnd - MIN_RISER_LENGTH_BARS, originStart + deltaBars)
          )
          nextLength = originEnd - nextStart
        }
        setDrag({ startBar: nextStart, lengthBars: nextLength })
      },
      (moved) => {
        setDrag(null)
        if (moved)
          dispatch({
            type: 'RESIZE_RISER',
            id: riser.id,
            startBar: nextStart,
            lengthBars: nextLength
          })
      }
    )
  }

  // The sweep and the swell, sampled across the block. Both come from the
  // shared twins of what the engine actually evaluates (riserCutoffAt /
  // riserEnvelopeAt), so this drawing cannot drift from the audio.
  const sweepPoints: string[] = []
  const swellPoints: string[] = [`0,${ROW_HEIGHT}`]
  for (let i = 0; i <= SHAPE_SAMPLES; i += 1) {
    const progress = i / SHAPE_SAMPLES
    const x = progress * widthPx
    const cutoff = riserCutoffAt({ ...riser, lengthBars }, progress * lengthBars)
    sweepPoints.push(`${x},${(1 - cutoff) * ROW_HEIGHT}`)
    swellPoints.push(`${x},${(1 - riserEnvelopeAt(progress)) * ROW_HEIGHT}`)
  }
  swellPoints.push(`${widthPx},${ROW_HEIGHT}`)

  const hatchId = `ra-riser-hatch-${riser.id}`

  return (
    <div style={{ position: 'relative', borderBottom: '1px solid var(--ra-border-soft)' }}>
      {/* The same NAME_BAR_HEIGHT + ROW_HEIGHT stack a clip's row uses, so a
          riser sits on exactly the lane a clip would and rows stay aligned
          whether they hold clips, risers or both. Spacer first, name bar
          positioned absolutely over it -- exactly RifffBlockRow's own
          arrangement. */}
      <div style={{ height: NAME_BAR_HEIGHT }} />
      {/* The riser's name, which is also this ROW's name: one riser owns one
          row now, so there is no separate channel label to invent. Editable
          in place rather than in the Inspector (where a clip is renamed)
          because a riser is not selectable -- state.sel holds a groupId --
          so the Inspector has no riser view to put it in. Sized/weighted
          like a clip's own name, minus the type colour (see this file's
          doc comment).

          This bar is ALSO the riser's drag surface, and that is what pushed
          renaming onto a double-click. With the lanes up the lane covers
          the block's whole body (AutomationLane's inset:0 at zIndex 4), so
          the body cannot be a move handle there -- which left a riser as the
          one element in the arranger that could not be moved while drawing,
          against "all clips should be selectable and movable in automation
          mode" (Elling). A clip solved the same problem by moving from its
          NAME BAR, which sits above the body and outside the lane; this is
          the riser's half of that, so the two behave alike. Rename is where
          a clip's own double-click-ish affordances live too.

          RESIZE is deliberately NOT given the same treatment: the edge
          handles stay inside the body, so resizing a riser stays an
          arrange-mode gesture for now. Moving is the one the lane was
          actually blocking.

          The stopPropagation guards are about the TIMELINE, not about any
          knob: every row in the arranger sits inside App.tsx's
          click-to-scrub background handler, so without them pressing on
          this bar would also jump the playhead (the same guard a clip's own
          name bar has carried since it was built). startPointerDrag stops
          the mousedown itself, but only once it has decided to run -- the
          explicit stop below covers the presses it declines (a secondary
          button, and every press while the field is open). Dial's own
          gesture guard is a separate thing and stays where it is -- see
          Dial.tsx. */}
      <div
        onMouseDown={(e) => {
          e.stopPropagation()
          // While the field is open the press belongs to the caret, not to
          // a move: beginMove's preventDefault would stop the input taking
          // focus at all.
          if (renaming) return
          beginMove(e)
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setRenaming(true)
        }}
        // focusout, which bubbles -- so this closes the field however it was
        // left (Enter, Escape, or clicking away), with no callback threaded
        // through EditableText for the one caller that needs it.
        onBlur={() => setRenaming(false)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenContextMenu(e.clientX, e.clientY, riser.id)
        }}
        title={renaming ? undefined : 'move or rename'}
        style={{
          position: 'absolute',
          top: 0,
          left: leftPx,
          width: widthPx,
          height: NAME_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--ra-s-1)',
          overflow: 'hidden',
          background: 'var(--ra-bg-row)',
          cursor: renaming ? 'text' : 'grab',
          zIndex: 2
        }}
      >
        {renaming ? (
          <EditableText
            value={riser.name}
            onCommit={(name) => dispatch({ type: 'RENAME_RISER', id: riser.id, name })}
            title="enter to keep"
            autoFocus
            style={{
              fontSize: 10,
              color: 'var(--ra-text-2)',
              width: '100%'
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 10,
              color: 'var(--ra-text-2)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {riser.name}
          </span>
        )}
      </div>
      {/* Flex row, matching StemWaveformRow's own shape exactly: the lane
          takes the space, and RowGainDial's zero-height sticky anchor rides
          the right edge beside the channel's m/s letters. */}
      <div style={{ display: 'flex', height: ROW_HEIGHT }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <div
            data-riser-id={riser.id}
            onMouseDown={beginMove}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onContextMenu={(e) => {
              // Stopped here so it never falls through to the Timeline's own
              // background menu, which would offer "add riser on a new row"
              // on top of the riser already under the cursor.
              e.preventDefault()
              e.stopPropagation()
              onOpenContextMenu(e.clientX, e.clientY, riser.id)
            }}
            title={`${riser.name} · ${lengthBars} bars`}
            style={{
              position: 'absolute',
              top: 0,
              left: leftPx,
              width: widthPx,
              height: ROW_HEIGHT,
              background: 'var(--ra-bg-row)',
              border: `1px solid ${hovered ? 'var(--ra-border-strong)' : 'var(--ra-border)'}`,
              cursor: 'grab',
              overflow: 'hidden'
            }}
          >
            <svg
              width={widthPx}
              height={ROW_HEIGHT}
              viewBox={`0 0 ${widthPx} ${ROW_HEIGHT}`}
              preserveAspectRatio="none"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                display: 'block',
                pointerEvents: 'none',
                // Muted reads as DIMMER, this app's established "grey means
                // quieter/off" language (StemWaveformRow drops its colour
                // layer for the same reason) -- the block keeps its outline
                // so a muted riser is still a thing you can grab, not a
                // hole in the row. The red lives on the row's m button.
                opacity: riser.muted ? 0.3 : 1
              }}
            >
              <defs>
                <pattern
                  id={hatchId}
                  width={HATCH_SPACING_PX}
                  height={HATCH_SPACING_PX}
                  patternUnits="userSpaceOnUse"
                  // Sloped the way the block reads, bottom-left to top-right --
                  // the hatch is doing double duty as texture and as direction.
                  patternTransform="rotate(-45)"
                >
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2={HATCH_SPACING_PX}
                    stroke="var(--ra-text)"
                    strokeWidth="1"
                    opacity="0.16"
                  />
                </pattern>
              </defs>
              <rect x="0" y="0" width={widthPx} height={ROW_HEIGHT} fill={`url(#${hatchId})`} />
              {/* The swell, filled -- "it gets louder towards the end", legible
                  without reading a number. */}
              <polygon points={swellPoints.join(' ')} fill="var(--ra-text)" opacity="0.1" />
              {/* The sweep, as a hairline. vectorEffect for the same reason
                  AutomationLane's polyline uses it: the viewBox is
                  non-uniformly scaled, which would otherwise stretch the stroke
                  into a wedge. */}
              <polyline
                points={sweepPoints.join(' ')}
                fill="none"
                stroke="var(--ra-text)"
                strokeWidth={1}
                opacity="0.75"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {/* Edge handles. 16px hit boxes over 5px visible strips, exactly
                like a clip's (see CollapsedRifffRow) -- the same gesture should
                feel the same wherever it is. Rendered above the block's own
                move surface so an edge press resizes rather than moves. */}
            {(['start', 'end'] as const).map((edge) => (
              <div
                key={edge}
                onMouseDown={(e) => beginResize(edge, e)}
                onContextMenu={(e) => e.stopPropagation()}
                title={`${lengthBars} bars`}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  [edge === 'start' ? 'left' : 'right']: 0,
                  width: 16,
                  cursor: 'ew-resize',
                  zIndex: 3
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    [edge === 'start' ? 'left' : 'right']: 0,
                    width: 5,
                    background: 'var(--ra-text)',
                    opacity: 0.12,
                    pointerEvents: 'none'
                  }}
                />
              </div>
            ))}
            {(automationLanes || laneOpenInPlace) && (
              // The riser's sweep, drawn in the ordinary automation lane -- see
              // AutomationLane's `riser` target. Laid over exactly this block,
              // same as a clip's lane is laid over its waveform, so the drawing
              // surface and the thing being edited are the same rectangle.
              //
              // Two ways in, one lane: the app-wide automation toggle, or this
              // one riser's lane being opened in place right after it was
              // drawn (laneOpenInPlace). The "done" button only appears on
              // the second -- with the lanes up the toggle is what closes it,
              // and a per-lane close there would be a second, contradictory
              // way out. Escape closes it either way it was opened in place,
              // which is also the only way out on a riser too narrow for the
              // lane's corner cluster to appear at all.
              <AutomationLane
                laneId={`riser:${riser.id}`}
                target={{ kind: 'riser', riserId: riser.id }}
                widthPx={widthPx}
                onClose={automationLanes ? undefined : onCloseLane}
              />
            )}
          </div>
        </div>
        {/* The riser's LEVEL, in the same place every other row keeps its
            gain (RowGainDial, pinned at the row's right edge beside the m/s
            letters) instead of a second knob in the block's corner. One row,
            one level control. */}
        <RowGainDial
          target={{ kind: 'riser', riserId: riser.id }}
          defaultGain={RISER_DEFAULTS.level}
          ariaLabel={`level for ${riser.name}`}
        />
      </div>
    </div>
  )
}
