// src/renderer/src/components/LockInConfirmDialog.tsx
import { useAppSelector, useDispatch } from '../state/StoreContext'
import { resolvePendingLockInConfirm } from '../state/useGatedRecordingControls'

// See ProjectLibraryBrowser.tsx's own buttonStyle doc comment -- buttons in
// this app have no default chrome, so every button needs an explicit
// dark-theme style or it falls back to near-invisible default control chrome.
// Sharp corners (no border-radius), per this app's design system.
function buttonStyle(): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 10,
    padding: '4px 10px',
    background: 'var(--ra-bg-row-active)',
    border: '1px solid var(--ra-border)',
    color: 'var(--ra-text)',
    cursor: 'pointer'
  }
}

// Mounted once, unconditionally, from App.tsx's Frame -- renders nothing
// while state.pendingLockInConfirm is false, so mounting it unconditionally
// is safe, matching this app's convention for other always-mounted-but-
// conditionally-rendered overlays. See useGatedRecordingControls.ts's own
// confirmLockInIfRecording for why this exists (a custom overlay replacing
// window.confirm's ambiguous, uncustomizable "OK"/"Cancel" for this specific
// interruption-style prompt) and pendingLockInConfirm's own doc comment on
// AppState for why its visibility lives in the shared reducer rather than
// local state here: confirmLockInIfRecording is called from multiple
// components' own independent useGatedRecordingControls() hook instances
// (App.tsx, RifffBlockRow.tsx), each with its own local React state, but
// there must only ever be ONE physical dialog on screen regardless of which
// instance triggered it.
//
// Same backdrop+panel structure as ProjectLibraryBrowser.tsx/
// ClusterStemsBrowser.tsx, but deliberately does NOT wire the backdrop's
// onClick to dismiss/discard -- "click outside to cancel" would just
// reintroduce the exact ambiguity (does dismissing mean keep it or lose it?)
// this dialog exists to remove. The user must press one of the two
// explicitly-labeled buttons.
export function LockInConfirmDialog(): React.JSX.Element | null {
  const pending = useAppSelector((s) => s.pendingLockInConfirm)
  const dispatch = useDispatch()

  if (!pending) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--ra-z-modal)',
        background: 'var(--ra-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          padding: 14,
          width: 320,
          fontSize: 11
        }}
      >
        <p style={{ margin: '0 0 12px', color: 'var(--ra-text)' }}>
          lock in the most recent recording pass?
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => resolvePendingLockInConfirm(dispatch, false)}
            style={buttonStyle()}
          >
            discard
          </button>
          <button onClick={() => resolvePendingLockInConfirm(dispatch, true)} style={buttonStyle()}>
            lock it in
          </button>
        </div>
      </div>
    </div>
  )
}
