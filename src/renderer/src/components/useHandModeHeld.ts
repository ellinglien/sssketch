import { useEffect, useState } from 'react'

/** Tracks whether the "M" hand-pan key is currently held — see Frame's pan
 * overlay in App.tsx, which appears over the arranger view while this is
 * true and lets the user drag anywhere to scroll it horizontally, instead
 * of having to grab the scrollbar directly. Same hold-while-held convention
 * (and the same alt-tab/blur safety concern) as useShiftHeld. Was "H" —
 * moved to "M" to leave more of the letter row free for per-channel mute
 * keys. */
export function useHandModeHeld(): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key.toLowerCase() !== 'm') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      setHeld(true)
    }
    function handleKeyUp(e: KeyboardEvent): void {
      if (e.key.toLowerCase() === 'm') setHeld(false)
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
