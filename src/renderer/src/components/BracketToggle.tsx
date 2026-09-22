/** Text-only on/off toggle, rendered "[x] label" / "[ ] label" -- direct
 * request, 2026-09-22 (option 3 of the Discover controls mockups),
 * replacing native checkboxes whose blue browser styling didn't fit the
 * monochrome pixel design. A real <button aria-pressed>, so it's
 * keyboard-reachable and gets the app-wide hover/pressed/focus styling. */
export function BracketToggle({
  checked,
  onChange,
  label,
  disabled = false,
  tooltip
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  tooltip?: string
}): React.JSX.Element {
  return (
    <button
      aria-pressed={checked}
      disabled={disabled}
      data-tooltip={tooltip}
      onClick={() => onChange(!checked)}
      style={{
        padding: '2px 3px',
        background: 'transparent',
        border: 'none',
        fontFamily: 'inherit',
        fontSize: 10,
        whiteSpace: 'pre',
        color: disabled ? 'var(--ra-text-4)' : checked ? 'var(--ra-text)' : 'var(--ra-text-3)',
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {checked ? '[x] ' : '[ ] '}
      {label}
    </button>
  )
}
