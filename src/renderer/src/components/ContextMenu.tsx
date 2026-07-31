import { useEffect, useRef } from 'react'

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
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Capture phase, not bubble — a bubble-phase window listener never fires
    // if anything the click lands on (a clip's own onClick/onContextMenu,
    // common throughout this app — row select, scrub, mute toggle, etc.)
    // calls stopPropagation() first, which silently left this menu open
    // through almost any click elsewhere. Capture fires on the way DOWN
    // from window, before any of those handlers get a chance to stop it, so
    // dismissal no longer depends on what the clicked element does. Only
    // exempted click target: something actually inside this menu (an item
    // button's own onClick already calls onClose() itself after running).
    function handleDismiss(e: MouseEvent): void {
      if (menuRef.current?.contains(e.target as Node)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    // Registered on the next tick, not immediately — the contextmenu event that
    // opens this (a right-click) is itself followed by a native 'click' in some
    // environments, which would otherwise dismiss the menu the instant it opens.
    const id = setTimeout(() => {
      window.addEventListener('click', handleDismiss, true)
      window.addEventListener('contextmenu', handleDismiss, true)
    }, 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('contextmenu', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 20,
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        borderRadius: 0,
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
            borderRadius: 0
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
