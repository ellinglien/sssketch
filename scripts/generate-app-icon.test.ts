import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { renderIconRgba, encodePng } from './generate-app-icon.mts'

function pixelAt(
  rgba: Buffer,
  size: number,
  x: number,
  y: number
): [number, number, number, number] {
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

describe('encodePng', () => {
  it('starts with the standard PNG signature', () => {
    const rgba = renderIconRgba(4)
    const png = encodePng(4, 4, rgba)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('IHDR declares the correct width, height, bit depth, and color type', () => {
    const rgba = renderIconRgba(4)
    const png = encodePng(4, 4, rgba)
    // IHDR chunk: 4-byte length, 4-byte type "IHDR", then 13 bytes of
    // data, starting right after the 8-byte PNG signature.
    const ihdr = png.subarray(8 + 8, 8 + 8 + 13)
    expect(ihdr.readUInt32BE(0)).toBe(4) // width
    expect(ihdr.readUInt32BE(4)).toBe(4) // height
    expect(ihdr[8]).toBe(8) // bit depth
    expect(ihdr[9]).toBe(6) // color type: RGBA
  })

  it('round-trips: decompressing IDAT recovers the exact original pixel data', () => {
    const rgba = renderIconRgba(8)
    const png = encodePng(8, 8, rgba)
    // IDAT chunk starts right after the 8-byte signature + 25-byte IHDR
    // chunk (4 length + 4 type + 13 data + 4 crc).
    const idatStart = 8 + 25
    const idatLength = png.readUInt32BE(idatStart)
    const idatData = png.subarray(idatStart + 8, idatStart + 8 + idatLength)
    const raw = inflateSync(idatData)
    // Strip each row's filter-type byte (always 0/None) and compare
    // against the original RGBA buffer.
    const rowBytes = 8 * 4
    for (let y = 0; y < 8; y++) {
      const rawRow = raw.subarray(y * (1 + rowBytes) + 1, (y + 1) * (1 + rowBytes))
      const originalRow = rgba.subarray(y * rowBytes, (y + 1) * rowBytes)
      expect(rawRow).toEqual(originalRow)
    }
  })
})
