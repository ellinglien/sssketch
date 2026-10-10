import { useAppSelector, useDispatch } from '../state/StoreContext'
import { startPointerDrag } from './dragUtils'
import {
  metronomeButtonTitle,
  metronomeVolumeBarPx,
  metronomeVolumeFromDrag
} from './metronomeVolume'

// A plain triangle-body + pendulum-arm silhouette, monochrome via
// currentColor -- matches this app's existing convention of drawing
// transport glyphs directly (▶/■ in the transport) rather than pulling in an
// icon library, and its "no emoji in chrome" design-system rule (CLAUDE.md).
function MetronomeIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M5 14 L8 2 L11 14 Z" strokeWidth="1.4" strokeLinejoin="round" />
      <line x1="8" y1="12" x2="11" y2="4" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="9.7" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** The app's one metronome switch: a click toggles it, a vertical drag sets
 * its volume. Used by the main transport and by Cross, and both drive the same
 * app-level state (metronomeEnabled / metronomeVolume), which StoreContext
 * sends to the engine. The engine clicks at the tempo of whatever project it
 * has loaded, so in Cross it follows the preview's tempo. */
export function MetronomeButton(): React.JSX.Element {
  const dispatch = useDispatch()
  const enabled = useAppSelector((state) => state.metronomeEnabled)
  const volume = useAppSelector((state) => state.metronomeVolume)
  return (
    <button
      onClick={() => dispatch({ type: 'TOGGLE_METRONOME' })}
      onMouseDown={(event) => {
        const startVolume = volume
        startPointerDrag(event, (_deltaX, deltaY) => {
          dispatch({
            type: 'SET_METRONOME_VOLUME',
            volume: metronomeVolumeFromDrag(startVolume, deltaY)
          })
        })
      }}
      aria-label="metronome"
      aria-pressed={enabled}
      title={metronomeButtonTitle(enabled, volume)}
      style={{
        height: 26,
        width: 26,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: enabled ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
        border: `1px solid ${enabled ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
        color: enabled ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
        position: 'relative'
      }}
    >
      <MetronomeIcon />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          right: 1,
          bottom: 1,
          width: 2,
          height: `${metronomeVolumeBarPx(volume)}px`,
          background: 'currentColor',
          pointerEvents: 'none'
        }}
      />
    </button>
  )
}
