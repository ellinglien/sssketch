import { useEffect } from 'react'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    function handleDismiss(): void {
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    // Registered on the next tick, not immediately — the contextmenu event that
    // opens this (a right-click) is itself followed by a native 'click' in some
    // environments, which would otherwise dismiss the menu the instant it opens.
    const id = setTimeout(() => {
      window.addEventListener('click', handleDismiss)
      window.addEventListener('contextmenu', handleDismiss)
    }, 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss)
      window.removeEventListener('contextmenu', handleDismiss)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 20,
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        borderRadius: 6,
        padding: 4,
        minWidth: 160,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            item.onClick()
            onClose()
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '6px 10px',
            fontSize: 11,
            border: 'none',
            background: 'transparent',
            color: item.danger ? 'var(--ra-mute-on)' : 'var(--ra-text)',
            cursor: 'pointer',
            borderRadius: 4
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
