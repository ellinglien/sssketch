import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// Matches index.ts's own default BrowserWindow width -- the one reference
// number the whole proportional-scaling scheme (.ra-frame's CSS transform,
// see global.css) is built from.
const REFERENCE_WINDOW_WIDTH = 1512

const FrameScaleContext = createContext<number | null>(null)

/** Wraps the app (see App.tsx's top-level App component) so any component
 * can read the CURRENT frameScale -- needed by every bit of code that
 * converts a real screen coordinate (clientX, getBoundingClientRect) into a
 * logical bar/pixel position (ppb is defined in logical, pre-scale pixels).
 * `.ra-frame` (global.css) is a fixed-size "design canvas" scaled via CSS
 * transform to match the current window size, rather than reflowing its
 * fixed-pixel children independently -- so real rendered pixels only equal
 * ppb's logical pixels 1:1 when frameScale happens to be exactly 1 (the
 * window is at its default 1512px width). Any raw `clientX - rect.left`
 * divided straight by ppb, with no frameScale correction, silently drifts
 * off target the moment the window is resized away from that default --
 * this was the root cause of at least three separate misclick reports
 * (StemWaveformRow's scrub click, Timeline's background click-to-scrub, and
 * drag-and-drop's grab-offset/drop-preview math) before each was traced
 * back to the same missing correction.
 *
 * Derived from window.innerWidth alone, not innerHeight -- innerWidth has
 * no OS chrome to account for (a title bar only adds height), and the
 * window's own aspect ratio is locked (index.ts's setAspectRatio), so width
 * and height always change in lockstep. */
export function FrameScaleProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [frameScale, setFrameScale] = useState(() => window.innerWidth / REFERENCE_WINDOW_WIDTH)
  useEffect(() => {
    function handleResize(): void {
      setFrameScale(window.innerWidth / REFERENCE_WINDOW_WIDTH)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  return <FrameScaleContext.Provider value={frameScale}>{children}</FrameScaleContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useFrameScale(): number {
  const value = useContext(FrameScaleContext)
  if (value === null) throw new Error('useFrameScale must be used within a FrameScaleProvider')
  return value
}

/** Converts a real on-screen x-distance (e.g. `clientX - rect.left`, both
 * from getBoundingClientRect()/a mouse event -- always in real, post-scale
 * screen pixels) into its logical, pre-scale equivalent -- the units ppb
 * and every bar-position calculation in this app are actually expressed
 * in. Pure and framework-agnostic so it's usable from plain functions
 * (App.tsx's barForClientX, dragGrabOffset.ts's mouseBarFromDragEvent) that
 * can't call useFrameScale() themselves -- callers read the value once via
 * the hook and pass it through as a plain number instead. */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, not a component
export function toLogicalX(realX: number, frameScale: number): number {
  return realX / frameScale
}
