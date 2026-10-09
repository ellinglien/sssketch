import type { ReactNode } from 'react'

/**
 * Pins a row's mixer controls (m/s/fx, gain) into Arrange's mixer rail: the
 * fixed column at the right edge of the arranger viewport, beside the
 * inspector, whatever the timeline's length or scroll position.
 *
 * A zero-size `position: sticky` box pushed to the row's far end with
 * `margin-left: auto`; the controls hang off it absolutely, to its left.
 * Being zero-WIDTH is the whole trick. Each arranger row is as wide as the
 * whole timeline, and a sticky box can only travel inside its containing
 * block (the row). The old anchor was a full-width block (no width set), so
 * it filled the row and had nowhere to move: `right: 0` did nothing and the
 * controls sat at the timeline's END, off screen on any arrangement longer
 * than the window (Ben's call, 2026-10-08: "oh, that's where they're
 * hidden"). A zero-width box at the row's end slides left until it meets
 * the viewport's right edge, which is where the rail is drawn (App.tsx).
 *
 * Zero-height too, so it never adds to the row's flow height.
 */
export function MixerRailAnchor({
  zIndex,
  children
}: {
  zIndex: number
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'sticky',
        right: 0,
        top: 0,
        width: 0,
        height: 0,
        marginLeft: 'auto',
        zIndex
      }}
    >
      {children}
    </div>
  )
}
