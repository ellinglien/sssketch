import { describe, it, expect } from 'vitest'
import { packIntoTracks } from './packIntoTracks'

interface Clip {
  name: string
  start: number
  end: number
}

function clip(name: string, start: number, end: number): Clip {
  return { name, start, end }
}

describe('packIntoTracks', () => {
  it('returns an empty array for no clips', () => {
    expect(
      packIntoTracks<Clip>(
        [],
        (c) => c.start,
        (c) => c.end
      )
    ).toEqual([])
  })

  it('packs non-overlapping clips onto a single track', () => {
    const a = clip('a', 0, 4)
    const b = clip('b', 4, 8)
    const c = clip('c', 10, 12)
    const result = packIntoTracks(
      [a, b, c],
      (x) => x.start,
      (x) => x.end
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual([a, b, c])
  })

  it('treats a clip starting exactly when another ends as non-overlapping (half-open interval)', () => {
    // Matches this codebase's own [start, end) convention used throughout
    // buildAlsXml.ts's segment math.
    const a = clip('a', 0, 4)
    const b = clip('b', 4, 8)
    const result = packIntoTracks(
      [a, b],
      (x) => x.start,
      (x) => x.end
    )
    expect(result).toHaveLength(1)
  })

  it('opens a second track for two fully overlapping clips', () => {
    const a = clip('a', 0, 10)
    const b = clip('b', 2, 8)
    const result = packIntoTracks(
      [a, b],
      (x) => x.start,
      (x) => x.end
    )
    expect(result).toHaveLength(2)
  })

  it('reuses a track once it frees up, minimizing total track count', () => {
    // A: 0-10, B: 5-15 (overlaps A), C: 12-20 (overlaps B, but NOT A --
    // starts after A ends at 10). Minimum possible is 2 tracks: A and C
    // share one track, B gets its own.
    const a = clip('a', 0, 10)
    const b = clip('b', 5, 15)
    const c = clip('c', 12, 20)
    const result = packIntoTracks(
      [a, b, c],
      (x) => x.start,
      (x) => x.end
    )
    expect(result).toHaveLength(2)
    const totalPlaced = result.reduce((sum, track) => sum + track.length, 0)
    expect(totalPlaced).toBe(3)
  })

  it('does not drop or duplicate any clip across a larger input', () => {
    const clips = [
      clip('a', 0, 5),
      clip('b', 1, 6),
      clip('c', 2, 7),
      clip('d', 8, 12),
      clip('e', 8, 20),
      clip('f', 15, 18)
    ]
    const result = packIntoTracks(
      clips,
      (x) => x.start,
      (x) => x.end
    )
    const allPlaced = result.flat()
    expect(allPlaced).toHaveLength(clips.length)
    expect(new Set(allPlaced.map((c) => c.name))).toEqual(new Set(clips.map((c) => c.name)))
  })

  it('sorts by start bar within each track (not insertion order)', () => {
    const a = clip('a', 10, 15)
    const b = clip('b', 0, 5)
    const result = packIntoTracks(
      [a, b],
      (x) => x.start,
      (x) => x.end
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual([b, a])
  })
})
