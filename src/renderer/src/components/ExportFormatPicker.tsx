/** Small format-choice modal for the "export project…" menu item -- shown
 * before dispatching to whichever format's own dialog/library/
 * next-to-source entry-point logic (see App.tsx's ProjectMenu component).
 * Stems export lives as its own top-level "export stems" menu item instead
 * (right next to "export mix"), not here -- only the two real DAW-project
 * formats need a "which one" choice. Styled to match TidyUpNudgeModal.tsx's
 * own dimmed-backdrop-plus-panel convention. */
export function ExportFormatPicker({
  onChoose,
  onCancel
}: {
  onChoose: (format: 'ableton' | 'reaper') => void
  onCancel: () => void
}): React.JSX.Element {
  const buttonStyle = {
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    height: 26,
    borderRadius: 0,
    padding: '0 10px',
    marginBottom: 6,
    fontSize: 11,
    border: '1px solid var(--ra-border)',
    background: 'var(--ra-bg-row-active)',
    color: 'var(--ra-text-2)',
    cursor: 'pointer'
  }

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
          width: 'min(260px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>export as</p>
        <div style={{ marginTop: 10 }}>
          <button style={buttonStyle} onClick={() => onChoose('ableton')}>
            ableton project
          </button>
          <button style={{ ...buttonStyle, marginBottom: 0 }} onClick={() => onChoose('reaper')}>
            reaper project
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            onClick={onCancel}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  )
}
