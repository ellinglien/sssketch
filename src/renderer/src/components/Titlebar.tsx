import { useEffect, useRef, useState } from 'react'

// No self-owned bottom border — App.tsx's Frame wraps this together with ProjectMenu
// in one row and owns the border there instead, so it spans the full row width under
// both rather than stopping partway. A standalone reuse of Titlebar elsewhere would
// need to supply its own border.

// 'normal' is still the real internal ArrangerMode value (store.ts) -- this
// is purely a display label. "timeline" reads better next to a project
// title than "normal" (normal relative to what?). Still used for the
// button's title tooltip even though the button's visible content is now
// an icon (see TimelineModeIcon/SketchModeIcon below) -- the word should
// still be readable on hover.
function modeLabel(mode: 'normal' | 'sketch'): string {
  return mode === 'normal' ? 'timeline' : mode
}

// User-supplied glyph (six mixer-channel-strip bars), reproduced verbatim.
// Filled shape rather than the stroke-based convention MetronomeIcon/
// GearIcon use (TransportBar.tsx) -- this source SVG is solid paths, not an
// outline glyph -- but it keeps their same principle of inheriting color
// from the wrapping button via currentColor rather than hardcoding one.
function TimelineModeIcon(): React.JSX.Element {
  return (
    <svg width="14" height={14 * (56 / 64)} viewBox="0 0 64 56" fill="currentColor">
      <path d="M60,48h-7c-2.2,0-4,1.8-4,4s1.8,4,4,4h7c2.2,0,4-1.8,4-4s-1.8-4-4-4Z" />
      <path d="M25,36c0,2.2,1.8,4,4,4h24c2.2,0,4-1.8,4-4s-1.8-4-4-4h-24c-2.2,0-4,1.8-4,4Z" />
      <path d="M4,24h31c2.2,0,4-1.8,4-4s-1.8-4-4-4H4c-2.2,0-4,1.8-4,4s1.8,4,4,4Z" />
      <path d="M4,56h15c2.2,0,4-1.8,4-4s-1.8-4-4-4H4c-2.2,0-4,1.8-4,4s1.8,4,4,4Z" />
      <path d="M4,40h9c2.2,0,4-1.8,4-4s-1.8-4-4-4H4c-2.2,0-4,1.8-4,4s1.8,4,4,4Z" />
      <path d="M16,8h35c2.2,0,4-1.8,4-4s-1.8-4-4-4H16c-2.2,0-4,1.8-4,4s1.8,4,4,4Z" />
    </svg>
  )
}

// User-supplied glyph (abstract doodle/scribble), reproduced verbatim. Same
// filled-shape rationale as TimelineModeIcon above.
function SketchModeIcon(): React.JSX.Element {
  return (
    <svg width="14" height={14 * (90 / 85.4)} viewBox="0 0 85.4 90" fill="currentColor">
      <path d="M72.9,14.2c3.9,5.6,7,11.7,9.7,18,.6,1.3.9,2.6,1.2,4,1.2,6.5,2.4,12.9.9,19.5-.9,4.1-1.2,8.4-2.3,12.5-1.3,5-3.2,9.9-6,14.3-1.4,2.2-3.7,3.4-6,4.3-2.6,1-5.5,1.4-8.3,2-2.1.5-4.2,1-6.3,1.1-4.6.3-9.1-.2-13.7-.8-2.1-.3-4.3-.5-6.4-.8-1.5-.3-3-.6-4.5-1.1-5.2-1.6-10-4.3-14.6-7.1-1.8-1.1-3.2-3.1-4.6-4.8-1.5-1.9-2.9-3.9-4.1-5.9-1.2-2.1-2.2-4.1-3.2-6.1-.9-1.8-1.9-3.7-2.7-5.6-.6-1.6-.9-3.3-1.2-5-.3-2.1-.5-4.3-.7-6.4-.3-4.8-.1-9.6,1.4-14.3.5-1.8,1.3-3.6,1.8-5.4.8-3.3,2.6-6,4.6-8.6,1.4-1.9,2.8-3.7,4.2-5.6,1.6-2.3,3.7-4.1,6.2-5.3,3-1.4,5.8-3,8.7-4.5C31.1.3,35.7,0,40.3,0c1.9,0,3.8.2,5.7.3,9.1.5,16.9,4,23.7,9.9,1.3,1.1,2.1,2.7,3.2,4ZM19,72.3c1.2,1.5,2.3,3,3.5,4.5.8.9,1.7,1.7,2.7,2.4,1.6,1.1,3.4,2.1,5.1,3.1,2.8,1.6,5.6,3.2,8.9,3.4,3.8.3,7.6,1.3,11.5.4,1.5-.4,3.1-.6,4.6-.8,4.6-.8,8.7-2.8,12.2-5.9,1.6-1.5,3.5-3.1,4.3-5,1.7-4.3,3.1-8.8,4.1-13.3.8-3.3.9-6.9,1.3-10.3.7-5.7-.2-11.3-1.7-16.6-2.2-7.8-6.4-14.7-11.7-20.9-5.4-6.3-12.2-9.8-20.6-9.8s-1.7-.1-2.6-.1c-2.4-.3-4.6.2-6.7,1.4-2.3,1.2-4.6,2.4-7,3.4-2.5,1-4.4,2.6-6,4.7s-3.1,4.2-4.7,6.2c-4,5.2-5.4,11.5-6.7,17.7v.5c.1,5.1.2,10.2.5,15.3.1,1.5.8,3,1.3,4.4.2.6.6,1.1.8,1.6.9,5.2,3.9,9.5,6.9,13.7Z" />
      <path d="M24.9,60.2c-1.2-2-2.5-4.1-3.7-6.2-2-3.4-2.2-7-1.7-10.8.2-1.7.1-3.5.6-5.1,1-3.6,2.3-7.3,5.3-9.9,1.9-1.6,3.7-3.4,5.9-4.6,1.7-1,3.9-1.3,6-1.5,2.4-.3,4.8-.3,7.2-.4,4.7-.1,8.7,1.7,12.5,4.4,1.2.9,2.5,1.8,3.7,2.8.7.5,1.3,1.2,1.7,1.9,1.8,3.4,3.7,6.9,5.2,10.4,1.8,4,1.3,8.3.5,12.5-.6,3.4-2,6.6-4.3,9.3-.2.2-.3.4-.4.6-1.4,3.1-3.6,5.3-6.7,6.9-3.3,1.7-6.5,2.5-10.1,1.7-.8-.2-1.5-.4-2.3-.5-6.9-1.1-12.1-5.2-17.4-9.3-.8-.5-1.3-1.4-2-2.2ZM32,57.5c1.7,3,4.5,4.9,7.2,6.8,3.3,2.4,7,4.2,11.1,4.5,1.1,0,2.8,0,3.4-.6,1.7-1.9,3.7-3.5,4.8-6,1.8-4.1,2.7-8.4,2.8-12.8,0-3.4-.4-6.7-3.8-8.6-.4-.2-.6-.6-.8-1-1.3-1.9-2.5-3.7-3.7-5.6-1-1.4-1.8-3-3.1-4.1-4-3.8-9.8-6.7-15.5-2.3-1.5,1.2-3.1,2.2-4.5,3.4-.6.5-1.2,1.1-1.4,1.8-.7,2.3-1.4,4.6-1.7,7-.7,6.5,1.1,12.3,5.2,17.5Z" />
      <path d="M53.6,45.3c1.5,1.6,1.5,4.6,1.2,7.7,0,1.1-.6,1.8-1.8,2.2-1.4.4-2.5,1.4-3.9,1.9-2.8,1-5.4,0-7.9-1.2,0,0-.3-.2-.4-.3-3.4-3.1-4-9.7-1.1-13.3,1.5-1.8,3.7-2.5,5.8-2.1,3,.4,5.5,1.8,8.1,5.1ZM48.8,44.2c-.9-1.2-1.2-1.2-2.5-.8-2.6.9-3.5,3.1-3.8,5.4-.3,2.2.6,4.3,2.4,5.7,1.2.9,2.7,1.1,4.2.3.4-.2,1-.6,1.1-1,.7-3.4.5-6.7-1.4-9.6Z" />
    </svg>
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
          title={
            mode === 'normal' && !sketchEligible
              ? 'mode: timeline (Tab) — sketch unavailable: clear fades, resizes, offsets, unlinked stems, and gaps first'
              : `mode: ${modeLabel(mode)} (Tab)`
          }
          style={{
            height: 20,
            borderRadius: 0,
            padding: '0 6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: mode !== 'normal' ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
            // Border stays the normal subtle token regardless of mode --
            // unlike TransportBar's similarly-shaped toggle buttons (gear/
            // tidy, metronome), this one already has TWO other signals for
            // active state (background color AND a swapped icon glyph), so
            // a third signal via a bright --ra-stretch-on border read as a
            // harsh white stroke on this small icon-only button. Per direct
            // feedback ("remove the white stroke around the sketch button").
            border: '1px solid var(--ra-border)',
            color: mode !== 'normal' ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
          }}
        >
          {mode === 'sketch' ? <SketchModeIcon /> : <TimelineModeIcon />}
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
        {rifffCount} rifffs · {stemCount} stems imported
      </div>
    </div>
  )
}
