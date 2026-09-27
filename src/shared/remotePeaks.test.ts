import { describe, expect, it } from 'vitest'
import { REMOTE_PEAK_BUCKETS, quantiseRemotePeaks } from './remotePeaks'

describe('quantiseRemotePeaks', () => {
  it('returns exactly the bucket count the page draws', () => {
    const peaks = Array.from({ length: 128 }, (_, i) => i / 127)
    expect(quantiseRemotePeaks(peaks)).toHaveLength(REMOTE_PEAK_BUCKETS)
    expect(REMOTE_PEAK_BUCKETS).toBe(64)
  })

  it('takes the MAX of each window, never an average', () => {
    // An average of a drum hit and the silence around it draws a quiet drum
    // hit -- the same rule peaksFromChannel and the page's own
    // peaksFromBuffer already follow.
    const peaks = [1, 0, 0, 0]
    expect(quantiseRemotePeaks(peaks, 2)).toEqual([100, 0])
  })

  it('scales to whole numbers from 0 to 100', () => {
    expect(quantiseRemotePeaks([0, 0.5, 1, 0.25], 4)).toEqual([0, 50, 100, 25])
  })

  it('clamps and abs-es rather than trusting its input', () => {
    // -3 abs-es to 3 and clamps to the top; a NaN and an infinity are
    // skipped, so their buckets are simply empty rather than NaN.
    expect(quantiseRemotePeaks([-3, 2, Number.NaN, Number.POSITIVE_INFINITY], 4)).toEqual([
      100, 100, 0, 0
    ])
  })

  it('stretches a short input rather than returning a short row', () => {
    // Two peaks over four buckets repeats each one, which draws a coarse
    // shape. Padding with silence would draw a shape that is half wrong.
    expect(quantiseRemotePeaks([1, 1], 4)).toEqual([100, 100, 100, 100])
  })

  it('reads an empty input as no waveform rather than throwing', () => {
    expect(quantiseRemotePeaks([])).toBeNull()
  })
})
