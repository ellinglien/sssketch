import { describe, expect, it } from 'vitest'
import { renderIconRgba } from './generate-app-icon.mts'

function pixelAt(rgba: Buffer, size: number, x: number, y: number): [number, number, number, number] {
  const offset = (y * size + x) * 4
  return [rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]]
}

describe('renderIconRgba', () => {
  it('fills the corner with the background color', () => {
    const rgba = renderIconRgba(1024)
    expect(pixelAt(rgba, 1024, 0, 0)).toEqual([0x0a, 0x0a, 0x0a, 0xff])
  })

  it('fills the left bar (low, left half) with the bar color', () => {
    const rgba = renderIconRgba(1024)
    // Left bar spans x 160-512, y 584-632 per the design spec -- sample
    // its center, (336, 608).
    expect(pixelAt(rgba, 1024, 336, 608)).toEqual([0xed, 0xed, 0xed, 0xff])
  })

  it('fills the right bar (high, right half) with the bar color', () => {
    const rgba = renderIconRgba(1024)
    // Right bar spans x 512-864, y 392-440 -- sample its center, (688, 416).
    expect(pixelAt(rgba, 1024, 688, 416)).toEqual([0xed, 0xed, 0xed, 0xff])
  })

  it('leaves the vertical center strip as background, between the two bars', () => {
    const rgba = renderIconRgba(1024)
    // At the canvas's own vertical center (512), neither bar reaches --
    // left bar's closest edge is y=584, right bar's is y=440.
    expect(pixelAt(rgba, 1024, 512, 512)).toEqual([0x0a, 0x0a, 0x0a, 0xff])
  })

  it('scales proportionally at a small size, not by resampling a fixed bitmap', () => {
    const rgba = renderIconRgba(64)
    // Same fractions as the 1024 case, scaled down: left bar's own
    // center is (336/1024)*64 = 21, (608/1024)*64 = 38.
    expect(pixelAt(rgba, 64, 21, 38)).toEqual([0xed, 0xed, 0xed, 0xff])
  })
})
