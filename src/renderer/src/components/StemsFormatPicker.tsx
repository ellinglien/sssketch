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
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 30
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(280px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <span className="ra-eyebrow">export stems as</span>
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
      </div>
    </div>
  )
}
