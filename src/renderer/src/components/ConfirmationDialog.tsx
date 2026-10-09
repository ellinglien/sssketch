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
 * the rest of sssketch rather than inheriting Chromium/macOS dialog chrome. */
export function ConfirmationDialog({
  message,
  detail,
  actions
}: {
  message: string
  detail?: string
  actions: ConfirmationDialogAction[]
}): React.JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={message}
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
          boxShadow: '0 10px 32px rgba(0,0,0,0.48)',
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
          {actions.map((action) => (
            <button key={action.label} onClick={action.onClick} style={buttonStyle(action)}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
