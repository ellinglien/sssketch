/** Shown once, on the very first launch (see App.tsx's Frame -- localStorage-
 * gated, separate flag from the welcome modal's own since this is a real
 * one-time setup decision, not a recurring reminder). Surfaces where sketches
 * actually get saved before the user ever hits Save for the first time,
 * rather than leaving that undiscoverable until they open the library
 * browser (which already shows/changes it too, via the same getLibraryRoot/
 * setLibraryRoot/pickFolder bridge -- this is just the first-run version of
 * that same control). */
export function LibraryLocationModal({
  libraryRoot,
  onChooseFolder,
  onContinue
}: {
  /** Null while the initial getLibraryRoot() call is still in flight. */
  libraryRoot: string | null
  onChooseFolder: () => void
  onContinue: () => void
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500
      }}
    >
      <div
        style={{
          width: 'min(380px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 18
        }}
      >
        <span className="ra-eyebrow">sketches save to</span>
        <div
          style={{
            fontSize: 11,
            color: 'var(--ra-text-2)',
            marginTop: 8,
            padding: '6px 8px',
            border: '1px solid var(--ra-border)',
            wordBreak: 'break-all'
          }}
        >
          {libraryRoot ?? '…'}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          <button
            onClick={onContinue}
            style={{
              height: 'auto',
              minHeight: 22,
              borderRadius: 0,
              padding: '4px 10px',
              fontSize: 10,
              whiteSpace: 'nowrap',
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            use this folder
          </button>
          <button
            onClick={onChooseFolder}
            style={{
              height: 'auto',
              minHeight: 22,
              borderRadius: 0,
              padding: '4px 10px',
              fontSize: 10,
              whiteSpace: 'nowrap',
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            choose folder…
          </button>
        </div>
      </div>
    </div>
  )
}
