import { describe, expect, it } from 'vitest'
import { findRiffArchiveRoot, riffArchivePickMessage, type ArchiveFs } from './riffArchiveRoot'

// Share readiness S7 (2026-10-07): the archive root is the folder that holds
// cache/common/warehouse.db3, and it was easy to pick one level off.
function fsWith(dbRoots: string[], dirs: Record<string, string[]> = {}): ArchiveFs {
  const dbs = new Set(dbRoots.map((r) => `${r}/cache/common/warehouse.db3`))
  return {
    exists: (p: string) => dbs.has(p),
    childDirs: (p: string) => dirs[p] ?? []
  }
}

describe('findRiffArchiveRoot', () => {
  it('takes the root itself', () => {
    expect(findRiffArchiveRoot('/v/LORE', fsWith(['/v/LORE']))).toEqual({
      ok: true,
      root: '/v/LORE'
    })
  })

  it('climbs from cache/common or cache up to the root', () => {
    const fs = fsWith(['/v/LORE'])
    expect(findRiffArchiveRoot('/v/LORE/cache/common', fs)).toEqual({ ok: true, root: '/v/LORE' })
    expect(findRiffArchiveRoot('/v/LORE/cache', fs)).toEqual({ ok: true, root: '/v/LORE' })
    expect(findRiffArchiveRoot('/v/LORE/cache/common/', fs)).toEqual({ ok: true, root: '/v/LORE' })
  })

  it('climbs one level from any other folder inside the root', () => {
    expect(findRiffArchiveRoot('/v/LORE/export', fsWith(['/v/LORE']))).toEqual({
      ok: true,
      root: '/v/LORE'
    })
  })

  it('looks one level down from the folder above the root', () => {
    const fs = fsWith(['/v/LORE'], { '/v': ['LORE', 'Photos'] })
    expect(findRiffArchiveRoot('/v', fs)).toEqual({ ok: true, root: '/v/LORE' })
  })

  it('refuses a folder with no archive near it, and one with several below', () => {
    expect(findRiffArchiveRoot('/v/Photos', fsWith([]))).toEqual({ ok: false, reason: 'none' })
    const fs = fsWith(['/v/a', '/v/b'], { '/v': ['a', 'b'] })
    expect(findRiffArchiveRoot('/v', fs)).toEqual({
      ok: false,
      reason: 'several',
      roots: ['/v/a', '/v/b']
    })
  })
})

describe('riffArchivePickMessage', () => {
  it('says what was looked for, in lowercase', () => {
    expect(riffArchivePickMessage({ ok: false, reason: 'none' }, '/v/Photos')).toBe(
      'no LORE archive in /v/Photos. pick the folder that holds cache/common/warehouse.db3.'
    )
    expect(
      riffArchivePickMessage({ ok: false, reason: 'several', roots: ['/v/a', '/v/b'] }, '/v')
    ).toBe('more than one LORE archive in /v (a, b). pick one of them.')
  })
})
