import { describe, expect, it } from 'vitest'
import { QR_QUIET_ZONE, qrSvg } from './qrSvg'

describe('qrSvg', () => {
  it('sizes the viewBox to the module count plus a quiet zone on both sides', () => {
    const svg = qrSvg('http://192.168.1.40:7373/?c=K7FD')
    // Version 1 is 21 modules; anything this app encodes is at least that.
    expect(svg.size).toBeGreaterThanOrEqual(21 + QR_QUIET_ZONE * 2)
    expect(svg.size % 2).toBe(1)
  })

  it('draws the top-left finder pattern at the quiet-zone offset', () => {
    const svg = qrSvg('http://192.168.1.40:7373/?c=K7FD')
    expect(svg.path.startsWith(`M${QR_QUIET_ZONE} ${QR_QUIET_ZONE}h1v1h-1z`)).toBe(true)
  })

  it('is deterministic for the same text', () => {
    expect(qrSvg('http://192.168.1.40:7373/?c=K7FD')).toEqual(
      qrSvg('http://192.168.1.40:7373/?c=K7FD')
    )
  })

  it('encodes different text differently', () => {
    expect(qrSvg('http://192.168.1.40:7373/?c=K7FD').path).not.toBe(
      qrSvg('http://192.168.1.40:7373/?c=M3PQ').path
    )
  })

  it('refuses empty text rather than drawing an unscannable square', () => {
    expect(() => qrSvg('')).toThrow()
  })
})
