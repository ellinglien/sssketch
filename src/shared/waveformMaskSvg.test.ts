import { describe, expect, it } from 'vitest'
import { waveformMaskDataUrl, waveformMaskSvg } from './waveformMaskSvg'

const rects = (svg: string): Record<string, number>[] =>
  [...svg.matchAll(/<rect ([^>]*)\/>/g)].map((m) =>
    Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], Number(a[2])]))
  )

describe('waveformMaskSvg', () => {
  it('draws one bar per peak on Waveform.tsx 128x100 stretched viewBox', () => {
    const svg = waveformMaskSvg([0.5, 1, 0.25, 0], [0, 0, 0, 0])
    expect(svg).toContain('viewBox="0 0 128 100"')
    expect(svg).toContain('preserveAspectRatio="none"')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    const bars = rects(svg)
    expect(bars).toHaveLength(4)
    expect(bars.map((b) => b.x)).toEqual([0, 32, 64, 96])
    expect(bars.every((b) => b.width === 32)).toBe(true)
  })

  it('scales bar heights with the peaks, centred on the midline', () => {
    const bars = rects(waveformMaskSvg([0.5, 1, 0.25, 0], [0, 0, 0, 0]))
    expect(bars[1].height).toBeCloseTo(2 * bars[0].height)
    expect(bars[0].height).toBeCloseTo(2 * bars[2].height)
    expect(bars[3].height).toBe(0)
    for (const b of bars) expect(b.y + b.height / 2).toBeCloseTo(50)
  })

  it('bakes brightness into fill-opacity the way Waveform does', () => {
    const bars = rects(waveformMaskSvg([1, 1, 1], [0, 0.5, 1]))
    expect(bars.map((b) => b['fill-opacity'])).toEqual([0.4, 0.7, 1])
  })

  it('draws white bars, so the mask alpha comes from fill-opacity alone', () => {
    expect(waveformMaskSvg([1], [1])).toContain('fill="#fff"')
  })

  it('handles empty peaks', () => {
    expect(rects(waveformMaskSvg([], []))).toHaveLength(0)
  })

  it('encodes a data URL that decodes back to the same SVG', () => {
    const url = waveformMaskDataUrl([0.3, 0.9], [0.1, 0.2])
    expect(url.startsWith('data:image/svg+xml,')).toBe(true)
    expect(decodeURIComponent(url.slice('data:image/svg+xml,'.length))).toBe(
      waveformMaskSvg([0.3, 0.9], [0.1, 0.2])
    )
  })
})
