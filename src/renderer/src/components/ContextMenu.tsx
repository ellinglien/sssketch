import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  /** Renders the item non-interactive (native `disabled`, so onClick can't
   * fire) -- for an action that's visible but currently unavailable rather
   * than hidden outright, e.g. auto-arrange's 32-bar length guard in
   * App.tsx. Pair with `title` to explain why. */
  disabled?: boolean
  /** Tooltip shown on hover -- the established way this app explains a
   * disabled control (see AudioDeviceModal.tsx, ChannelRow.tsx). */
  title?: string
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  ignoreRef
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  /** The trigger button that opened this menu, if the caller wants
   * click-to-toggle on it. Exempts that element from the outside-click
   * dismissal below, so a click on the trigger is handled ONLY by its own
   * onClick (the toggle-if-open guard callers already write), not raced
   * against this capture-phase listener too. Previously every caller's
   * onClick guard (`if (menuState) close else open`) tried to win that race
   * by reading a stale closure of menuState -- relying on this capture-phase
   * setState NOT having resolved yet by the time the button's bubble-phase
   * onClick ran. That assumption doesn't hold: the state update resolves in
   * time, so the guard read the already-nulled value and reopened the menu,
   * reproducing exactly the "clicking the trigger again does nothing" bug
   * it was meant to fix. Excluding the trigger here removes the race
   * entirely instead of trying to win it. */
  ignoreRef?: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  // Starts at the requested (x, y), then clamped once the menu's real
  // rendered size is known (below) -- x/y alone (e.g. a button's own
  // rect.left/rect.bottom, see App.tsx's export menu) take no account of
  // how close that point is to the window's own edge, so a menu opened
  // near the right edge previously rendered partially outside the
  // Electron window's own frame (unlike a browser tab, there's no OS
  // desktop for the overflow to spill onto -- it's just clipped).
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    setPosition({ left, top })
  }, [x, y])

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
      if (ignoreRef?.current?.contains(e.target as Node)) return
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
  }, [onClose, ignoreRef])

  return (
    <div
      ref={menuRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
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
          disabled={item.disabled}
          title={item.title}
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
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            borderRadius: 0,
            // tokens.css / docs/design.md's disabled convention: 30% opacity,
            // not-allowed cursor -- same rule this app's disabled buttons
            // already follow elsewhere (see AudioDeviceModal.tsx et al.).
            opacity: item.disabled ? 0.3 : 1
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
