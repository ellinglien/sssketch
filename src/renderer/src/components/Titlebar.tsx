import { useEffect, useRef, useState } from 'react'

// No self-owned bottom border — App.tsx's Frame wraps this together with ProjectMenu
// in one row and owns the border there instead, so it spans the full row width under
// both rather than stopping partway. A standalone reuse of Titlebar elsewhere would
// need to supply its own border.

// 'normal' is still the real internal ArrangerMode value (store.ts) -- this
// is purely a display label, used both for the button's own visible text
// and its tooltip. Per direct feedback, this went back to a text switch
// (see the button below) after the bespoke icon glyphs it briefly used
// turned out to read as confusing rather than clearer.
function modeLabel(mode: 'normal' | 'sketch'): string {
  return mode === 'normal' ? 'arranger' : mode
}

// The switch's own moving indicator -- sits on the leading edge (before the
// label in arranger mode, after it in sketch mode, see the button below),
// a small solid mark rather than a second bespoke icon. currentColor so it
// tracks the button's own state color exactly like the label text does.
function SwitchMark(): React.JSX.Element {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        background: 'currentColor',
        flex: 'none'
      }}
    />
  )
}

export function Titlebar({
  sketchName,
  rifffCount,
  stemCount,
  mode,
  sketchEligible,
  onCycleMode,
  onRename,
  renameError
}: {
  /** The real current project name, already resolved by the caller (see
   * App.tsx's Frame) -- was previously a hardcoded "untitled sketch 04"
   * placeholder that never reflected the actual sketch, library-saved or
   * not, a real reported bug. */
  sketchName: string
  rifffCount: number
  stemCount: number
  /** The arranger's current view mode -- was previously its own separate
   * cycling button in TransportBar.tsx; moved here (beside the project
   * title, matching ProjectMenu's own button style) since which mode
   * you're in is more a property of the PROJECT view than a playback
   * transport control. */
  mode: 'normal' | 'sketch'
  sketchEligible: boolean
  onCycleMode: () => void
  /** Called with whatever was typed when a rename is committed (Enter or
   * blur, non-empty and different from the current name). App.tsx's Frame
   * owns the actual rename logic -- Titlebar itself stays presentational.
   * Fire-and-forget from here; rejection is signaled back via renameError,
   * not a thrown value. */
  onRename: (newName: string) => void
  /** Non-null right after a rename attempt was rejected (e.g. name already
   * taken) -- shown inline next to the name. */
  renameError?: string | null
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
        {renameError && (
          <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>{renameError}</span>
        )}
        <button
          onClick={onCycleMode}
          aria-label="Cycle arranger mode"
          data-tour-id="tour-mode"
          title={
            mode === 'normal' && !sketchEligible
              ? 'mode: arranger (Tab) — sketch unavailable: clear fades, resizes, offsets, unlinked stems, and gaps first'
              : `mode: ${modeLabel(mode)} (Tab)`
          }
          style={{
            height: 20,
            borderRadius: 0,
            padding: '0 8px',
            fontSize: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: mode !== 'normal' ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
            // Border stays the normal subtle token regardless of mode --
            // unlike TransportBar's similarly-shaped toggle buttons (gear/
            // tidy, metronome), this one already has TWO other signals for
            // active state (background color AND the switch mark flipping
            // sides), so a third signal via a bright --ra-stretch-on border
            // read as a harsh white stroke on this small button. Per direct
            // feedback ("remove the white stroke around the sketch button").
            border: '1px solid var(--ra-border)',
            color: mode !== 'normal' ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
          }}
        >
          {mode === 'normal' ? (
            <>
              <SwitchMark />
              <span>arranger</span>
            </>
          ) : (
            <>
              <span>sketch</span>
              <SwitchMark />
            </>
          )}
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
        {rifffCount} rifffs · {stemCount} stems imported
      </div>
    </div>
  )
}
