import { useEffect, useState } from 'react'

/** Tracks whether Cmd (the hand-pan modifier) is currently held — see
 * Frame's handlePanMouseDown in App.tsx, which starts a drag-to-pan only
 * when a mousedown is both Cmd-held and lands directly on the timeline's
 * own background (never on a clip, whose own Cmd+drag means "duplicate").
 * This hook only tracks the key itself, for the cursor hint (grab/grabbing)
 * shown at the document level while it's held -- matches Cmd's other role
 * as the zoom modifier (Cmd+scroll), so one modifier key covers both
 * "navigate the viewport" gestures. Was bound to "M" (before that, "H") as
 * its own dedicated key; unified onto Cmd once the per-channel mute
 * shortcuts that motivated moving off letter keys were removed entirely. */
export function useHandModeHeld(): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Meta') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      setHeld(true)
    }
    function handleKeyUp(e: KeyboardEvent): void {
      if (e.key === 'Meta') setHeld(false)
    }
    function handleBlur(): void {
      setHeld(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  return held
}
