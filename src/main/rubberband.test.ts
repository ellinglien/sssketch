import { describe, expect, it } from 'vitest'
import { cacheKey, pathsToEvict } from './rubberband'

describe('cacheKey', () => {
  it('is deterministic for the same path and ratio', () => {
    expect(cacheKey('/x/a.wav', 0.6667)).toBe(cacheKey('/x/a.wav', 0.6667))
  })

  it('differs when the ratio differs', () => {
    expect(cacheKey('/x/a.wav', 0.6667)).not.toBe(cacheKey('/x/a.wav', 0.75))
  })

  it('differs when the path differs', () => {
    expect(cacheKey('/x/a.wav', 0.6667)).not.toBe(cacheKey('/x/b.wav', 0.6667))
  })

  it('quantizes ratio to 4 decimal places, so finer differences collide', () => {
    expect(cacheKey('/x/a.wav', 0.666666)).toBe(cacheKey('/x/a.wav', 0.666674))
  })

  it('always produces a .wav filename', () => {
    expect(cacheKey('/x/a.wav', 1.5)).toMatch(/^[0-9a-f]{40}\.wav$/)
  })
})

describe('pathsToEvict', () => {
  it('evicts nothing when total size is under the limit', () => {
    const entries = [
      { path: '/a', size: 100, mtimeMs: 1 },
      { path: '/b', size: 100, mtimeMs: 2 }
    ]
    expect(pathsToEvict(entries, 1000)).toEqual([])
  })

  it('evicts the oldest entries first until under the limit', () => {
    const entries = [
      { path: '/old', size: 500, mtimeMs: 1 },
      { path: '/mid', size: 400, mtimeMs: 2 },
      { path: '/new', size: 300, mtimeMs: 3 }
    ]
    expect(pathsToEvict(entries, 600)).toEqual(['/old', '/mid'])
  })

  it('stops evicting as soon as the total drops back under the limit', () => {
    const entries = [
      { path: '/old', size: 500, mtimeMs: 1 },
      { path: '/new', size: 400, mtimeMs: 2 }
    ]
    expect(pathsToEvict(entries, 800)).toEqual(['/old'])
  })
})

// Real, 2026-10-01: a 0-byte placeholder (an unfinished LORE download)
// reached rubberband, which failed with "Format not recognised". Nothing
// to stretch there: it is a stem not downloaded yet, said in one line.
describe('renderStretched on a 0-byte stem', () => {
  it('rejects as not downloaded without running rubberband', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { renderStretched } = await import('./rubberband')
    const { StemNotDownloadedError } = await import('@shared/stemNotDownloaded')
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-rubberband-test-'))
    try {
      const path = join(dir, 'e22be9a0c5a011eba9a004dd407500b5')
      writeFileSync(path, '')
      await expect(renderStretched(path, 0.75)).rejects.toBeInstanceOf(StemNotDownloadedError)
      await expect(renderStretched(path, 1)).rejects.toBeInstanceOf(StemNotDownloadedError)
      await expect(renderStretched(join(dir, 'missing'), 0.75)).rejects.toBeInstanceOf(
        StemNotDownloadedError
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
