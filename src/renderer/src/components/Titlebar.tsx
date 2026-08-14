import { useEffect, useRef, useState } from 'react'

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
  dirty
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
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sketchName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function startEditing(): void {
    setDraft(sketchName === 'untitled sketch' ? '' : sketchName)
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
      <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
        {rifffCount} rifffs · {stemCount} stems imported
      </div>
    </div>
  )
}
