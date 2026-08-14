// src/renderer/src/components/UnsavedChangesDialog.tsx

// Same backdrop+panel shape as LockInConfirmDialog.tsx, but driven by plain
// props (App.tsx's Frame owns the visibility state and a stored
// resolve-function ref) rather than reducer state -- confirmDiscardIfDirty
// is only ever invoked from within Frame itself, or from a callback Frame
// hands down as a prop (see ProjectLibraryBrowser.tsx's
// onBeforeReplaceProject), never from several independent component
// instances at once the way LockInConfirmDialog's pendingLockInConfirm
// needs to be (see that component's own doc comment for why THAT one
// needs reducer-level state). So this one skips that complexity entirely
// and just takes callback props.
//
// Deliberately no backdrop-click-to-dismiss, for the same reason
// LockInConfirmDialog has none: "click outside to cancel" would just
// reintroduce the exact ambiguity (save? discard? cancel?) this dialog
// exists to remove. The user must press one of the three explicitly
// labeled buttons.
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

export function UnsavedChangesDialog({
  onSave,
  onDiscard,
  onCancel
}: {
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}): React.JSX.Element {
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
        <p style={{ margin: '0 0 12px', color: 'var(--ra-text)' }}>
          this project has unsaved changes.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={buttonStyle()}>
            cancel
          </button>
          <button onClick={onDiscard} style={buttonStyle()}>
            discard
          </button>
          <button onClick={onSave} style={buttonStyle()}>
            save
          </button>
        </div>
      </div>
    </div>
  )
}
