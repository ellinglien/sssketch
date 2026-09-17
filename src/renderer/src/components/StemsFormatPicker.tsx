/** Small choice modal for the "export stems" menu item -- shown before
 * dispatching to whichever variant's own dialog/library/next-to-source
 * entry-point logic (see App.tsx's ProjectMenu component). Styled to match
 * ExportFormatPicker.tsx exactly (same dimmed-backdrop-plus-panel
 * convention, itself matching TidyUpNudgeModal.tsx). */
export function StemsFormatPicker({
  onChoose,
  onCancel
}: {
  onChoose: (format: 'stems' | 'stemTracks') => void
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
          width: 'min(280px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>export stems as</p>
        <div style={{ marginTop: 10 }}>
          <button style={buttonStyle} onClick={() => onChoose('stems')}>
            mixed by bus
          </button>
          <button
            style={{ ...buttonStyle, marginBottom: 0 }}
            onClick={() => onChoose('stemTracks')}
          >
            individual tracks
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
