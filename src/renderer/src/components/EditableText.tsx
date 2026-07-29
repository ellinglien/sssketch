import { useState, type CSSProperties } from 'react'

/**
 * Click-to-edit text — looks like plain text until focused, then behaves
 * like TransportBar's tempo field: decoupled local state while focused (so
 * typing isn't fighting a controlled value that could change from
 * elsewhere), committing on blur/Enter. Escape reverts without committing.
 * A blank or unchanged commit is silently discarded rather than calling
 * onCommit — mirrors SET_TEMPO's own "revert rather than commit garbage"
 * handling, so callers never need to guard against an empty rename.
 */
export function EditableText({
  value,
  onCommit,
  style,
  title
}: {
  value: string
  onCommit: (value: string) => void
  style?: CSSProperties
  title?: string
}): React.JSX.Element {
  const [text, setText] = useState(value)
  const [focused, setFocused] = useState(false)
  if (!focused && text !== value) setText(value)

  function commit(): void {
    setFocused(false)
    const trimmed = text.trim()
    if (trimmed && trimmed !== value) {
      onCommit(trimmed)
    } else {
      setText(value)
    }
  }

  return (
    <input
      type="text"
      value={text}
      title={title}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setText(value)
          e.currentTarget.blur()
        }
      }}
      style={{
        background: focused ? 'var(--ra-bg-row-active)' : 'transparent',
        border: `1px solid ${focused ? 'var(--ra-border-strong)' : 'transparent'}`,
        color: 'inherit',
        font: 'inherit',
        padding: '1px 3px',
        margin: '-1px -3px',
        outline: 'none',
        minWidth: 0,
        ...style
      }}
    />
  )
}
