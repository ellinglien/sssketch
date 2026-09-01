import { useEffect, useRef, useState } from 'react'
import { modeLabel } from '../state/selectors'

// Matches ProjectMenu's own buttonStyle (App.tsx) exactly -- the mode
// toggle button below moved up here from TransportBar.tsx per direct
// feedback ("same style as the other grey buttons," no special
// highlight), so it needs to actually look like NEW/OPEN/SAVE/TIDY/EXPORT
// rather than the red-text/white-outline treatment it had down there.
// Duplicated rather than shared/exported -- both are small, one-off
// per-component style objects in this codebase's existing convention
// (TransportBar's own buttons are all hand-rolled inline too), not worth
// a new shared module for one flat object.
const buttonStyle: React.CSSProperties = {
  height: 22,
  borderRadius: 0,
  padding: '0 10px',
  fontSize: 10,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text-2)'
}

// No self-owned bottom border — App.tsx's Frame wraps this together with ProjectMenu
// in one row and owns the border there instead, so it spans the full row width under
// both rather than stopping partway. A standalone reuse of Titlebar elsewhere would
// need to supply its own border.

export function Titlebar({
  sketchName,
  rifffCount,
  stemCount,
  onRename,
  renameError,
  dirty,
  mode,
  sketchEligible,
  onCycleMode
}: {
  /** The real current project name, already resolved by the caller (see
   * App.tsx's Frame) -- was previously a hardcoded "untitled sketch 04"
   * placeholder that never reflected the actual sketch, library-saved or
   * not, a real reported bug. */
  sketchName: string
  rifffCount: number
  stemCount: number
  /** Called with whatever was typed when a rename is committed (Enter or
   * blur, non-empty and different from the current name). App.tsx's Frame
   * owns the actual rename logic -- Titlebar itself stays presentational.
   * Fire-and-forget from here; rejection is signaled back via renameError,
   * not a thrown value. */
  onRename: (newName: string) => void
  /** Non-null right after a rename attempt was rejected (e.g. name already
   * taken) -- shown inline next to the name. */
  renameError?: string | null
  /** True when the live project differs from what's last known to be
   * durably saved -- see state/unsavedChanges.ts's hasUnsavedChanges.
   * Shown as a small dot next to the project name; App.tsx's Frame is the
   * only place that knows both sides of that comparison. */
  dirty?: boolean
  /** Arranger/sketch mode toggle -- moved here from TransportBar.tsx per
   * direct feedback: sits up in the empty gap of this row (between the
   * project name and the rifff/stem count) instead of down in the
   * transport row, and drops the white-outline stroke it had there for
   * the plain grey buttonStyle stroke above -- same look whichever mode is
   * active, no background/border highlight. The label text itself stays
   * red (var(--ra-mute-on), see the button's own style below), the one
   * thing per direct feedback that should still stand out. */
  mode: 'normal' | 'sketch'
  sketchEligible: boolean
  onCycleMode: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sketchName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function startEditing(): void {
    setDraft(sketchName === 'untitled' ? '' : sketchName)
    setEditing(true)
  }

  function commit(): void {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed.length === 0 || trimmed === sketchName) return
    onRename(trimmed)
  }

  return (
    <div
      style={{
        height: 38,
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>sssketch</span>
        <span style={{ color: 'var(--ra-text-4)' }}>|</span>
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
            style={{
              fontSize: 12,
              padding: '1px 4px',
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row)',
              color: 'var(--ra-text)'
            }}
          />
        ) : (
          <span
            onClick={startEditing}
            title="click to rename"
            style={{ color: 'var(--ra-text-2)', cursor: 'pointer' }}
          >
            {sketchName}
          </span>
        )}
        {dirty && (
          <span
            title="unsaved changes"
            aria-label="unsaved changes"
            style={{ color: 'var(--ra-text-3)', fontSize: 14, lineHeight: 1 }}
          >
            •
          </span>
        )}
        {renameError && (
          <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>{renameError}</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={onCycleMode}
          aria-label="Cycle arranger mode"
          data-tour-id="tour-mode"
          title={
            mode === 'normal' && !sketchEligible
              ? 'mode: arrange (Tab) — sketch unavailable: clear fades, resizes, offsets, unlinked stems, and gaps first'
              : `mode: ${modeLabel(mode)} (Tab)`
          }
          style={{
            ...buttonStyle,
            // Fixed, not content-width -- "arrange" and "sketch" are
            // different lengths, and per direct feedback the button itself
            // shouldn't visibly resize when the mode flips. Sized to fit
            // "arrange" (the longer label) comfortably.
            width: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            // Text stays red (unlike every other plain grey button here) --
            // per direct feedback this one label should still stand out as
            // the mode indicator, while the stroke stays the same neutral
            // grey as the rest of buttonStyle (no white outline).
            color: 'var(--ra-mute-on)'
          }}
        >
          {modeLabel(mode)}
        </button>
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
          {rifffCount} rifffs · {stemCount} stems imported
        </div>
      </div>
    </div>
  )
}
