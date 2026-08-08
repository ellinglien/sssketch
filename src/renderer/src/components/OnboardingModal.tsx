/** Shown once, on the very first launch (see App.tsx's Frame -- persisted
 * via localStorage, same convention as LoreLibraryBrowser.tsx's own
 * loreUsername setting). A short explanation of what sssketch actually is
 * and the two ways to get audio in, for a tester who's never seen it
 * before -- not a multi-step wizard, matching this codebase's own "avoid
 * over-designing" convention for informational UI (see TidyUpNudgeModal). */
export function OnboardingModal({
  onDismiss,
  onOpenEndlesss
}: {
  onDismiss: () => void
  /** Dismisses AND opens the Endlesss login/import browser directly --
   * the shortest path from "just installed this" to "have real audio in
   * the timeline" for anyone with an Endlesss account already. */
  onOpenEndlesss: () => void
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
          width: 'min(480px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 20
        }}
      >
        <span className="ra-eyebrow">welcome</span>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>
          sssketch turns Endlesss stems into a real arrangement
        </div>
        <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginTop: 10, lineHeight: 1.6 }}>
          drop rifffs onto a timeline, trim and offset them, group similar-sounding stems together
          automatically, and export the result as an Ableton Live project.
        </div>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ra-text)' }}>
              getting audio in
            </div>
            <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginTop: 3, lineHeight: 1.6 }}>
              drag a rifff export folder onto the shelf at the bottom, or click{' '}
              <span style={{ color: 'var(--ra-text)' }}>import</span> to log into Endlesss and
              browse your jams directly.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ra-text)' }}>tidy up</div>
            <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginTop: 3, lineHeight: 1.6 }}>
              groups similar-sounding stems onto shared tracks automatically, so an arrangement
              doesn&apos;t turn into a wall of overlapping clips.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ra-text)' }}>
              sketch / arranger
            </div>
            <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginTop: 3, lineHeight: 1.6 }}>
              sketch mode is a simplified, linear view for quickly roughing out a structure; switch
              to arranger for the full timeline.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            onClick={onDismiss}
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
            start sketching
          </button>
          <button
            onClick={onOpenEndlesss}
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
            log into endlesss
          </button>
        </div>
      </div>
    </div>
  )
}
