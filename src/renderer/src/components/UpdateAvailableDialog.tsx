// src/renderer/src/components/UpdateAvailableDialog.tsx
import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/updateState'

// Self-contained, mounted once and unconditionally from App.tsx (see
// <LockInConfirmDialog /> for the same "no props, subscribes to its own
// state source, renders null when there's nothing to show" convention) --
// unlike UnsavedChangesDialog.tsx (driven by a caller-owned prop), this one
// has exactly one source of truth (main/index.ts's update-state-changed
// push) and no caller ever needs to control its visibility directly.
//
// Same backdrop+panel visual treatment as UnsavedChangesDialog.tsx --
// sharp corners (no border-radius), monochrome shell, no backdrop-click-
// to-dismiss (same reasoning: an ambiguous "click outside" shouldn't stand
// in for an explicit button press on something this consequential).
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

export function UpdateAvailableDialog(): React.JSX.Element | null {
  const [state, setState] = useState<UpdateState>({ state: 'idle' })

  useEffect(() => window.rifffApi.onUpdateStateChanged(setState), [])

  if (state.state === 'idle') return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'rgba(0, 0, 0, 0.4)',
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
        {state.state === 'available' && (
          <>
            <p style={{ margin: '0 0 12px', color: 'var(--ra-text)' }}>
              a new version of sssketch is available (v{state.version}) -- update now?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => void window.rifffApi.dismissUpdate()} style={buttonStyle()}>
                later
              </button>
              <button
                onClick={() => void window.rifffApi.confirmUpdateInstall()}
                style={buttonStyle()}
              >
                update now
              </button>
            </div>
          </>
        )}
        {state.state === 'downloading' && (
          <>
            <p style={{ margin: '0 0 12px', color: 'var(--ra-text)' }}>
              downloading update... {Math.round(state.percent)}%
            </p>
            <div
              style={{
                height: 4,
                background: 'var(--ra-bg)',
                border: '1px solid var(--ra-border)'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${state.percent}%`,
                  background: 'var(--ra-text)'
                }}
              />
            </div>
          </>
        )}
        {state.state === 'installing' && (
          <p style={{ margin: 0, color: 'var(--ra-text)' }}>
            installing update -- sssketch will restart in a moment.
          </p>
        )}
        {state.state === 'error' && (
          <>
            <p style={{ margin: '0 0 12px', color: 'var(--ra-text)' }}>
              update failed: {state.error}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => void window.rifffApi.dismissUpdate()} style={buttonStyle()}>
                dismiss
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
