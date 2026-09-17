import { useBusyMessage } from '../state/BusyContext'
import { LoadingLoader } from './LoadingLoader'

/** Renders nothing while idle; a full-screen blocking overlay (spinner +
 * status message) whenever something has called useBusy()'s setter with a
 * non-null message. `pointerEvents: 'auto'` on the overlay itself is what
 * actually blocks interaction with everything underneath -- the app's own
 * content keeps rendering (and reacting to state) behind it, just unable to
 * receive clicks/drags while this is up. */
export function BusyOverlay(): React.JSX.Element | null {
  const message = useBusyMessage()
  if (message === null) return null
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--ra-z-fullscreen)',
        background: 'color-mix(in srgb, var(--ra-bg-page) 80%, transparent)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        cursor: 'wait',
        pointerEvents: 'auto'
      }}
    >
      <LoadingLoader size={64} />
      <div style={{ fontSize: 11, color: 'var(--ra-text-2)' }}>{message}</div>
    </div>
  )
}
