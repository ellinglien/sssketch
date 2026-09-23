import { KEY_GESTURES } from '@shared/keyGestures'

/** Settings menu's "keys and gestures…" entry — the app's only
 * documentation of its own shortcuts and mouse gestures, after the copy
 * pass of 2026-09-23 cut every tooltip to two or three words and took most
 * of them with it.
 *
 * Same modal shell as AudioDeviceModal.tsx (which itself copies
 * OnboardingModal.tsx's fixed-overlay + centered-card shape) — wider, and
 * with its own scroll, because the list is long enough to outgrow a short
 * window and a shortcuts reference that clips is no reference at all.
 *
 * The content is data (src/shared/keyGestures.ts), not JSX, so the copy can
 * be held to the app's rules by a unit test — same arrangement as
 * tourSteps.ts and the tour. Nothing here decides what is in the list. */
export function KeyGesturesModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--ra-z-modal)'
      }}
    >
      <div
        style={{
          width: 'min(560px, 90vw)',
          // Leaves the card visibly inside the window at the shortest
          // height this app is usable at, rather than running off both
          // edges -- the list itself scrolls, the shell does not.
          maxHeight: '80vh',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>keys and gestures</p>

        <div
          style={{
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}
        >
          {KEY_GESTURES.map((group) => (
            <div
              key={group.area}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ra-s-1)' }}
            >
              <span className="ra-eyebrow">{group.area}</span>
              {group.gestures.map((gesture) => (
                <div
                  key={gesture.keys}
                  style={{
                    display: 'flex',
                    // Wraps rather than squeezing the two columns together
                    // at narrow widths -- the keys column is the one that
                    // has to stay readable.
                    flexWrap: 'wrap',
                    gap: 'var(--ra-s-2)',
                    alignItems: 'baseline'
                  }}
                >
                  <span
                    style={{
                      width: 172,
                      flex: 'none',
                      fontSize: 10,
                      color: 'var(--ra-text)'
                    }}
                  >
                    {gesture.keys}
                  </span>
                  <span style={{ flex: 1, minWidth: 140, fontSize: 10, color: 'var(--ra-text-2)' }}>
                    {gesture.does}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          style={{
            alignSelf: 'flex-end',
            height: 28,
            borderRadius: 0,
            padding: '0 14px',
            fontSize: 11,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row-active)',
            color: 'var(--ra-text)',
            cursor: 'pointer'
          }}
        >
          close
        </button>
      </div>
    </div>
  )
}
