import { useDispatch, usePlaying } from '../state/StoreContext'
import { startPointerDrag } from './dragUtils'

const PPB = 24

// Compact mode's own, much denser horizontal scale — deliberately a
// separate constant (not a shrunk row height on the same PPB Normal mode
// uses) so far more bars fit in the same viewport width, matching "compact
// horizontally too, not just vertically." Every bar<->pixel conversion the
// timeline uses (Ruler's own ticks, clipGeometry, drag/drop position math)
// has to agree on which scale is active, so this is threaded through
// wherever state.mode is checked rather than hardcoded — see Timeline in
// App.tsx for the single place that decides which one applies.
const COMPACT_PPB = 2

export function Ruler({
  bars: barCount,
  ppb = PPB
}: {
  bars: number
  ppb?: number
}): React.JSX.Element {
  const dispatch = useDispatch()
  const playing = usePlaying()
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
    if (playing) void window.rifffApi.engineSetPosition(clamped)
  }

  function handleScrubStart(e: React.MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const startBar = Math.max(0, (e.clientX - rect.left) / ppb)
    seekTo(startBar)
    startPointerDrag(e, (deltaX) => {
      seekTo(startBar + deltaX / ppb)
    })
  }

  return (
    <div
      onMouseDown={handleScrubStart}
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
      </div>
    </div>
  )
}

export { PPB, COMPACT_PPB }
