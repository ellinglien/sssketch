import { useEffect, useState } from 'react'

/** Tracks whether the Shift key is currently held, for the keyboard mute
 * shortcuts' visual hint (mute dot -> square + letter while held, see
 * StemWaveformRow). Each caller keeps its own listener rather than
 * threading this through app state — it fires far more often than any
 * change is worth pushing through the undo-tracked reducer for, and
 * nothing besides this visual hint depends on the value. */
export function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Shift') setHeld(true)
    }
    function handleKeyUp(e: KeyboardEvent): void {
      if (e.key === 'Shift') setHeld(false)
    }
    // Without this, alt-tabbing (or any other way of losing window focus)
    // while Shift is physically held leaves `held` stuck true forever — the
    // corresponding keyup fires in a different window/app that this page
    // never sees.
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
