import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// Matches index.ts's own default BrowserWindow size -- the one reference
// rectangle the whole proportional-scaling scheme (.ra-frame's CSS
// transform, see global.css) is built from.
const REFERENCE_WINDOW_WIDTH = 1512
const REFERENCE_WINDOW_HEIGHT = 982

const FrameScaleContext = createContext<number | null>(null)

/** The smaller of the two axis-wise scale factors, so `.ra-frame` (a fixed
 * 1512x982 box, centered via translate(-50%,-50%)) always fits fully
 * within the real window on BOTH axes -- not just width. Width alone was
 * the original formula, on the assumption that index.ts's own
 * win.setAspectRatio(1512/982) always holds so height necessarily follows
 * width in lockstep. That assumption is real but not airtight: confirmed
 * the hard way -- a window moved across displays with different available
 * screen sizes (e.g. a large external monitor to a smaller laptop screen)
 * can get force-fit by macOS to whatever the new display actually has
 * room for, overriding the app's own size/aspect-ratio constraints in a
 * way that isn't a user-initiated resize the app gets a say in. When that
 * happens, window.innerHeight ends up shorter than what the width-only
 * formula assumes, .ra-frame's scaled height exceeds the real viewport,
 * and the centering transform clips equal amounts off the TOP and BOTTOM
 * -- which is exactly what silently ate the top toolbar row (Titlebar +
 * ProjectMenu, see App.tsx) in that scenario, with no error or visible
 * sign anything was wrong (the app just looked like it had no top bar).
 * Taking the min of both axes costs nothing in the normal (ratio-locked)
 * case, where both formulas agree. */
function computeFrameScale(): number {
  return Math.min(
    window.innerWidth / REFERENCE_WINDOW_WIDTH,
    window.innerHeight / REFERENCE_WINDOW_HEIGHT
  )
}

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
 * Computed via computeFrameScale (above) -- the min of the width-wise and
 * height-wise scale factors, not width alone, precisely so a window that
 * ends up off the intended aspect ratio (see computeFrameScale's own doc
 * comment) still gets a frame that fits the real viewport on both axes
 * instead of silently clipping a whole row of UI off one edge. */
export function FrameScaleProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [frameScale, setFrameScale] = useState(computeFrameScale)
  useEffect(() => {
    function handleResize(): void {
      setFrameScale(computeFrameScale())
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
