import { useEffect, useRef, useState } from 'react'
import { backgroundScanGate } from '../audio/backgroundScanGate'

/** Shown when "New" is clicked, after the discard-unsaved-changes confirm
 * already passed -- lets the user see and edit the auto-generated name
 * BEFORE a new project is actually created, instead of the old silent
 * apply-and-go. Aimed at cutting down on anonymously-auto-named clutter in
 * the project library. Deliberately does no state reset itself -- that only
 * happens in onCreate (App.tsx), so cancel truly leaves the current project
 * untouched. See docs/superpowers/specs/
 * 2026-08-08-project-workflow-polish-design.md. */
export function NewProjectModal({
  defaultName,
  defaultBpm,
  onCreate,
  onCancel
}: {
  defaultName: string
  /** The last open project's tempo (lastProjectTempo.ts), falling back to
   * initialState.bpm -- direct request, 2026-09-22. */
  defaultBpm: number
  onCreate: (name: string, bpm: number) => void
  onCancel: () => void
}): React.JSX.Element {
  // Background scans stay paused while this modal is open -- their
  // UI-thread analysis made its inputs lag (backgroundScanGate.ts).
  useEffect(() => backgroundScanGate.hold(), [])

  const [name, setName] = useState(defaultName)
  // Direct request, 2026-09-20: "when creating a new project, prompt user
  // to adjust the tempo" -- every new project used to silently start at
  // initialState's own hardcoded bpm with no chance to set it up front.
  // Seeded from `defaultBpm` -- the last open project's tempo since
  // 2026-09-22 (App.tsx passes loadLastProjectTempo(initialState.bpm)).
  // Free-type-until-blur/Enter, clamped to [40, 200] on commit rather than
  // on every keystroke -- same pattern TransportBar.tsx's and Discover's
  // own tempo fields already use.
  const [bpmText, setBpmText] = useState(String(defaultBpm))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  function commit(): void {
    const trimmed = name.trim()
    const parsedBpm = Number(bpmText)
    const bpm = Number.isFinite(parsedBpm)
      ? Math.min(200, Math.max(40, Math.round(parsedBpm)))
      : defaultBpm
    onCreate(trimmed.length > 0 ? trimmed : defaultName, bpm)
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
          width: 'min(360px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ra-text)' }}>name this project</p>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') onCancel()
          }}
          autoFocus
          style={{
            display: 'block',
            width: '100%',
            marginTop: 10,
            height: 26,
            padding: '0 8px',
            fontSize: 12,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row)',
            color: 'var(--ra-text)'
          }}
        />
        <p style={{ margin: 0, marginTop: 14, fontSize: 11, color: 'var(--ra-text)' }}>tempo</p>
        <input
          type="number"
          min={40}
          max={200}
          value={bpmText}
          onChange={(e) => setBpmText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') onCancel()
          }}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 10,
            height: 26,
            padding: '0 8px',
            fontSize: 12,
            border: '1px solid var(--ra-border)',
            background: 'var(--ra-bg-row)',
            color: 'var(--ra-text)'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
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
          <button
            onClick={commit}
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
            create
          </button>
        </div>
      </div>
    </div>
  )
}
