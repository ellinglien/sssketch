import { useEffect, useRef } from 'react'
import { dialogKeyAction, safeActionIndex } from './confirmationDialogKeys'

export interface ConfirmationDialogAction {
  label: string
  onClick: () => void
  danger?: boolean
  primary?: boolean
}

function buttonStyle(action: ConfirmationDialogAction): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 10,
    padding: '4px 10px',
    background: action.primary ? 'var(--ra-border)' : 'var(--ra-bg-row-active)',
    border: `1px solid ${action.primary ? 'var(--ra-border-strong)' : 'var(--ra-border)'}`,
    color: action.danger ? 'var(--ra-mute-on)' : 'var(--ra-text)',
    cursor: 'pointer'
  }
}

/** App-native replacement for browser confirm dialogs. It deliberately
 * shares the same flat panel, backdrop, type scale and button treatment as
 * the rest of sssketch rather than inheriting Chromium/macOS dialog chrome.
 * Keyboard: focus starts on the safe button (cancel), Escape chooses it, Tab
 * stays inside, and focus goes back where it was when the dialog closes. Its
 * keys stop here, so the app's own shortcuts (Space plays) don't run under it. */
export function ConfirmationDialog({
  message,
  detail,
  actions
}: {
  message: string
  detail?: string
  actions: ConfirmationDialogAction[]
}): React.JSX.Element {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])
  const actionsRef = useRef(actions)
  useEffect(() => {
    actionsRef.current = actions
  })
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    buttonsRef.current[safeActionIndex(actionsRef.current)]?.focus()
    return () => previous?.focus()
  }, [])

  function onKeyDown(event: React.KeyboardEvent): void {
    const buttons = buttonsRef.current.slice(0, actions.length)
    const focused = buttons.findIndex((b) => b === document.activeElement)
    const next = dialogKeyAction(event.key, event.shiftKey, focused, buttons.length, actions)
    event.stopPropagation()
    if (next.kind === 'none') return
    event.preventDefault()
    if (next.kind === 'choose') actions[next.index]?.onClick()
    else buttons[next.index]?.focus()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={message}
      onKeyDown={onKeyDown}
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
          border: '1px solid var(--ra-border-strong)',
          boxShadow: 'var(--ra-shadow-popover)',
          padding: 14,
          width: 320,
          fontSize: 11
        }}
      >
        <p style={{ margin: detail ? '0 0 6px' : '0 0 12px', color: 'var(--ra-text)' }}>
          {message}
        </p>
        {detail && (
          <p style={{ margin: '0 0 12px', color: 'var(--ra-text-3)', lineHeight: 1.5 }}>{detail}</p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {actions.map((action, index) => (
            <button
              key={action.label}
              ref={(el) => {
                buttonsRef.current[index] = el
              }}
              onClick={action.onClick}
              style={buttonStyle(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
