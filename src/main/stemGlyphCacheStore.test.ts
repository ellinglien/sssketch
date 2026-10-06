import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { GlyphBands } from '@shared/glyphBands'
import { pitchContourToBytes } from '@shared/glyphBands'
import {
  getStemGlyphCache,
  setStemGlyphCache,
  stemGlyphCacheKeyFor,
  type StatFn
} from './stemGlyphCacheStore'

const CID = '0123456789abcdef0123456789abcdef'

function bands(seed: number): GlyphBands {
  const row = (k: number): number[] => Array.from({ length: 16 }, (_, i) => (seed + k + i) / 100)
  return { bass: row(0), mid: row(1), treble: row(2) }
}

function pitch(values: number[]): { numFrames: number; bytes: Uint8Array } {
  return { numFrames: values.length, bytes: pitchContourToBytes(new Float32Array(values)) }
}

function statOf(size: number, mtimeMs: number): StatFn & ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ size, mtimeMs }))
}

describe('stemGlyphCacheKeyFor', () => {
  it('keys a library stem by its StemCID with no stamp, without touching the disk', async () => {
    const stat = statOf(1, 1)
    expect(await stemGlyphCacheKeyFor(`/lib/jam/${CID}`, stat)).toEqual({ key: CID, stamp: '' })
    expect(stat).not.toHaveBeenCalled()
  })

  it('keys any other file by its path, stamped size:mtimeMs', async () => {
    expect(await stemGlyphCacheKeyFor('/p/a.wav', statOf(1234, 1700000000123.5))).toEqual({
      key: '/p/a.wav',
      stamp: '1234:1700000000123.5'
    })
  })

  it('a file that cannot be stat-ed has no key', async () => {
    const stat = vi.fn(async () => {
      throw new Error('ENOENT')
    })
    expect(await stemGlyphCacheKeyFor('/p/gone.wav', stat)).toBeNull()
  })
})

describe('stemGlyphCacheStore', () => {
  it('reads and writes by StemCID', async () => {
    const db = new Database(':memory:')
    expect(await getStemGlyphCache(db, `/lib/j/${CID}`)).toBeNull()
    await setStemGlyphCache(db, `/lib/j/${CID}`, { bands: bands(1) }, 10)
    // the same stem in another jam's folder is the same row
    expect(await getStemGlyphCache(db, `/lib/other/${CID}`)).toEqual({
      bands: bands(1),
      pitch: null
    })
  })

  it('reads and writes by path with a stamp; a stamp mismatch is a miss', async () => {
    const db = new Database(':memory:')
    await setStemGlyphCache(db, '/p/a.wav', { bands: bands(2) }, 10, statOf(100, 5))
    expect(await getStemGlyphCache(db, '/p/a.wav', statOf(100, 5))).toEqual({
      bands: bands(2),
      pitch: null
    })
    expect(await getStemGlyphCache(db, '/p/a.wav', statOf(100, 6))).toBeNull()
    expect(await getStemGlyphCache(db, '/p/a.wav', statOf(101, 5))).toBeNull()
  })

  it('partial upserts combine: bands, then pitch', async () => {
    const db = new Database(':memory:')
    await setStemGlyphCache(db, `/lib/j/${CID}`, { bands: bands(3) }, 10)
    await setStemGlyphCache(db, `/lib/j/${CID}`, { pitch: pitch([0, 220.5, 440.25]) }, 11)
    const got = await getStemGlyphCache(db, `/lib/j/${CID}`)
    expect(got?.bands).toEqual(bands(3))
    expect(got?.pitch?.numFrames).toBe(3)
    expect(Array.from(new Float32Array(new Uint8Array(got!.pitch!.bytes).buffer))).toEqual([
      0, 220.5, 440.25
    ])
  })

  it('a rewrite under a new stamp drops the half it did not provide (a file re-baked in place)', async () => {
    const db = new Database(':memory:')
    await setStemGlyphCache(db, '/p/b.baked.wav', { bands: bands(4) }, 10, statOf(10, 1))
    await setStemGlyphCache(db, '/p/b.baked.wav', { pitch: pitch([1, 2]) }, 11, statOf(10, 1))
    await setStemGlyphCache(db, '/p/b.baked.wav', { pitch: pitch([3]) }, 12, statOf(20, 2))
    const got = await getStemGlyphCache(db, '/p/b.baked.wav', statOf(20, 2))
    expect(got?.bands).toBeNull()
    expect(got?.pitch?.numFrames).toBe(1)
    expect(await getStemGlyphCache(db, '/p/b.baked.wav', statOf(10, 1))).toBeNull()
  })

  it('a file that cannot be stat-ed is neither read nor written', async () => {
    const db = new Database(':memory:')
    const gone = vi.fn(async () => {
      throw new Error('ENOENT')
    })
    await setStemGlyphCache(db, `/lib/j/${CID}`, { bands: bands(5) }, 10)
    await setStemGlyphCache(db, '/p/gone.wav', { bands: bands(5) }, 10, gone)
    expect(await getStemGlyphCache(db, '/p/gone.wav', gone)).toBeNull()
    expect(db.prepare(`SELECT CacheKey FROM StemGlyphCache`).all()).toEqual([{ CacheKey: CID }])
  })

  it('a corrupt bands row reads as no bands; a pitch blob of the wrong size as no pitch', async () => {
    const db = new Database(':memory:')
    await setStemGlyphCache(db, `/lib/j/${CID}`, { bands: bands(6), pitch: pitch([1, 2]) }, 10)
    db.prepare(`UPDATE StemGlyphCache SET BandsJSON = '{nope', PitchFrames = 5`).run()
    expect(await getStemGlyphCache(db, `/lib/j/${CID}`)).toBeNull()
  })
})
