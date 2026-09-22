import { describe, it, expect } from 'vitest'
import { muteRegionsClipPath } from './muteClipPath'

describe('muteRegionsClipPath', () => {
  it('returns undefined when there is nothing to clip', () => {
    expect(muteRegionsClipPath(200, 44, [], 24, 0)).toBeUndefined()
  })

  it('punches one evenodd hole per muted region, positioned relative to the clip', () => {
    const d = muteRegionsClipPath(200, 44, [{ startBar: 2, endBar: 4 }], 10, 10)

    // Base rect first, then the hole: bar 2 at ppb 10 is x=20, minus the
    // clip's own leftPx of 10 -> 10; bar 4 -> 30.
    expect(d).toBe('path(evenodd, "M0,0 L200,0 L200,44 L0,44 Z M10,0 L30,0 L30,44 L10,44 Z")')
  })

  it('keeps one hole per region', () => {
    const d = muteRegionsClipPath(
      200,
      44,
      [
        { startBar: 0, endBar: 1 },
        { startBar: 3, endBar: 4 }
      ],
      10,
      0
    ) as string
    expect(d.match(/Z/g)).toHaveLength(3) // base + two holes
  })
})
