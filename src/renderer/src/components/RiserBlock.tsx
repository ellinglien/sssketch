import { useState } from 'react'
import { MIN_RISER_LENGTH_BARS, riserCutoffAt, riserEnvelopeAt } from '@shared/riser'
import { AutomationLane } from './AutomationLane'
import { Dial } from './Dial'
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

/** Below this the level dial is dropped, leaving the block readable. Same
 * idea (and the same reason) as AutomationLane's own picker threshold: a
 * one-bar riser at a low zoom is narrower than the control. */
const LEVEL_DIAL_MIN_WIDTH_PX = 56

const DIAL_SIZE = 18

/**
 * ONE placed noise riser, drawn on its channel's row.
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
  onOpenContextMenu
}: {
  riserId: string
  /** Opens the app's own context menu for this riser -- the same callback
   * shape, and the same journey up through ChannelRow to App, that a clip's
   * menu already takes (onOpenClipMenu). Owning the menu's CONTENTS up there
   * rather than here is what keeps every right-click in the arranger looking
   * and behaving like one thing. */
  onOpenContextMenu: (x: number, y: number, riserId: string) => void
}): React.JSX.Element | null {
  const dispatch = useDispatch()
  const ppb = useZoom()
  const riser = useAppSelector((s) => s.risers[riserId])
  const automationMode = useAppSelector((s) => s.mode === 'automation')
  const [hovered, setHovered] = useState(false)

  // The in-progress geometry of a move/resize. Local state rather than
  // state.dragPlayedBars & friends: nothing outside this block needs to see a
  // half-finished drag (unlike a clip's volume, which the engine wants live),
  // and keeping it here means a drag costs no dispatches at all until it
  // lands.
  const [drag, setDrag] = useState<{ startBar: number; lengthBars: number } | null>(null)

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
  const showLevelDial = widthPx >= LEVEL_DIAL_MIN_WIDTH_PX && !automationMode

  return (
    <div style={{ position: 'relative', borderBottom: '1px solid var(--ra-border-soft)' }}>
      {/* The same NAME_BAR_HEIGHT + ROW_HEIGHT stack a clip's row uses, so a
          riser sits on exactly the lane a clip would and rows stay aligned
          whether they hold clips, risers or both. A riser's label lives
          inside the block rather than in a separate bar above it: there is no
          expand/collapse and no stem list, so a bar of its own would be a
          strip of empty chrome. */}
      <div style={{ height: NAME_BAR_HEIGHT }} />
      <div style={{ height: ROW_HEIGHT, position: 'relative' }}>
        <div
          data-riser-id={riser.id}
          onMouseDown={beginMove}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onContextMenu={(e) => {
            // Stopped here so it never falls through to the Timeline's own
            // background menu, which would offer "add riser here" on top of
            // the riser already under the cursor.
            e.preventDefault()
            e.stopPropagation()
            onOpenContextMenu(e.clientX, e.clientY, riser.id)
          }}
          title={`riser · ${lengthBars} bars · drag to move · drag an edge to resize · right-click to remove`}
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
              pointerEvents: 'none'
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
          <span
            style={{
              position: 'absolute',
              left: 4,
              top: 2,
              fontSize: 9,
              color: 'var(--ra-text-2)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap'
            }}
          >
            riser
          </span>
          {showLevelDial && (
            // The riser's LEVEL, as a knob in its corner -- the same
            // treatment (and the same component) the filter lane's resonance
            // already uses, for the same reason: it is one stored number, not
            // a shape to draw. Keeping the knob's own press off this block's
            // move drag is Dial's own job now, not this wrapper's -- see
            // Dial.tsx's doc comment; this span is only placement.
            <span style={{ position: 'absolute', right: 3, top: 3, display: 'flex' }}>
              <Dial
                value={Math.round(riser.level * 100)}
                onChange={(value) =>
                  dispatch({ type: 'SET_RISER_LEVEL', id: riser.id, level: value / 100 })
                }
                defaultValue={60}
                size={DIAL_SIZE}
                ariaLabel={`riser level for ${riser.id}`}
                tooltip="riser level"
              />
            </span>
          )}
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
          {automationMode && (
            // The riser's sweep, drawn in the ordinary automation lane -- see
            // AutomationLane's `riser` target. Laid over exactly this block,
            // same as a clip's lane is laid over its waveform, so the drawing
            // surface and the thing being edited are the same rectangle.
            <AutomationLane
              laneId={`riser:${riser.id}`}
              target={{ kind: 'riser', riserId: riser.id }}
              widthPx={widthPx}
            />
          )}
        </div>
      </div>
    </div>
  )
}
