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
  title,
  autoFocus
}: {
  value: string
  onCommit: (value: string) => void
  style?: CSSProperties
  title?: string
  /** Focus (and select) on mount. For callers that only MOUNT this field
   * once the user has asked to rename -- a riser's name bar, which is its
   * drag surface until double-clicked -- where the gesture that opened the
   * field is not itself a click on the field. Left off by default: a field
   * that is always on screen (the Inspector's) must not steal focus. */
  autoFocus?: boolean
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
      autoFocus={autoFocus}
      onFocus={(e) => {
        setFocused(true)
        // Select the whole name on an auto-focused open, so the first
        // keystroke replaces "riser 3" rather than appending to it. Only on
        // that path: clicking into an always-present field (the Inspector's)
        // should put the caret where the click landed, as it always has.
        if (autoFocus) e.currentTarget.select()
      }}
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
        border: '1px solid transparent',
        color: 'inherit',
        font: 'inherit',
        padding: '1px var(--ra-s-0)',
        margin: '-1px -3px',
        minWidth: 0,
        ...style
      }}
    />
  )
}
