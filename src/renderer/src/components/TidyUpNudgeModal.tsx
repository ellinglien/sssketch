/** Shown from the Ableton export flow when the current project hasn't been
 * tidied up yet (state.busOf is empty -- ClusterStemsBrowser.tsx's
 * ASSIGN_TO_BUS/ASSIGN_STEMS_TO_BUS are its only callers, so an empty
 * busOf reliably means "never tidied"). Matches this codebase's preference
 * for clearly-labeled buttons over a generic OK/Cancel confirm. See
 * docs/superpowers/specs/2026-08-08-project-workflow-polish-design.md. */
export function TidyUpNudgeModal({
  onTidyUp,
  onExportAnyway
}: {
  onTidyUp: () => void
  onExportAnyway: () => void
}): React.JSX.Element {
  return (
    <div
      onClick={onExportAnyway}
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
          width: 'min(380px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <span className="ra-eyebrow">this project hasn&apos;t been tidied up yet</span>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ra-text-2)' }}>
          tidy up groups similar stems onto shared Ableton tracks, making the exported project much
          easier to mix. tidy up first?
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button
            onClick={onExportAnyway}
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
            export anyway
          </button>
          <button
            onClick={onTidyUp}
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
            tidy up first
          </button>
        </div>
      </div>
    </div>
  )
}
