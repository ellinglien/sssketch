/** Small format-choice modal for the "export project…" menu item -- shown
 * before dispatching to whichever format's own dialog/library/
 * next-to-source entry-point logic (see App.tsx's ProjectMenu component).
 * Styled to match TidyUpNudgeModal.tsx's own dimmed-backdrop-plus-panel
 * convention. */
export function ExportFormatPicker({
  onChoose,
  onCancel
}: {
  onChoose: (format: 'ableton' | 'reaper' | 'stems') => void
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
          width: 'min(260px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <span className="ra-eyebrow">export as</span>
        <div style={{ marginTop: 10 }}>
          <button style={buttonStyle} onClick={() => onChoose('ableton')}>
            ableton project
          </button>
          <button style={buttonStyle} onClick={() => onChoose('reaper')}>
            reaper project
          </button>
          <button style={{ ...buttonStyle, marginBottom: 0 }} onClick={() => onChoose('stems')}>
            stems (grouped by bus)
          </button>
        </div>
      </div>
    </div>
  )
}
