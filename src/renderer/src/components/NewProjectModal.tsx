import { useEffect, useRef, useState } from 'react'

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
  onCreate,
  onCancel
}: {
  defaultName: string
  onCreate: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  function commit(): void {
    const trimmed = name.trim()
    onCreate(trimmed.length > 0 ? trimmed : defaultName)
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
          width: 'min(360px, 90vw)',
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 16
        }}
      >
        <span className="ra-eyebrow">name this project</span>
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
