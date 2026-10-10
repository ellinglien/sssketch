import { describe, expect, it } from 'vitest'
import {
  collectReonedNames,
  isReonedCopyFileName,
  isStaleTempFileName,
  reonedNamesInText
} from './reonedNames'

const HASH = '0123456789abcdef0123456789abcdef.baked.wav'
const UUID = '6f1c2a9e-1b2c-4d5e-8f90-123456789abc.baked.wav'

describe('reonedNamesInText', () => {
  it('finds hashed and legacy uuid names anywhere in raw project JSON, by basename', () => {
    const json = JSON.stringify({
      rifffs: {
        g: { stems: [{ path: `/Volumes/X/lib/.bakes/${HASH}`, phaseSourcePath: '/a.wav' }] }
      },
      other: `/old/root/.sssketch-bakes/${UUID}`
    })
    expect([...reonedNamesInText(json)].sort()).toEqual([HASH, UUID].sort())
  })

  it('finds a name in JSON written on Windows-style escaped paths too', () => {
    const json = JSON.stringify({ path: `C:\\lib\\.bakes\\${HASH}` })
    expect([...reonedNamesInText(json)]).toEqual([HASH])
  })

  it('stays linear on a long run of name characters (a base64 plugin state of zeros)', () => {
    const run = 'A'.repeat(2_000_000)
    const started = performance.now()
    expect([...reonedNamesInText(`{"state":"${run}","p":"/b/${HASH}"}`)]).toEqual([HASH])
    expect([...reonedNamesInText(`{"state":"${run}.baked.wav"}`)]).toHaveLength(1)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('ignores ordinary audio', () => {
    expect([...reonedNamesInText('{"path":"/a/b.wav","x":"baked.wav"}')]).toEqual([])
  })
})

describe('collectReonedNames', () => {
  it('walks shared undo snapshots once and finds names in any string', () => {
    const stems = [{ path: `/lib/.bakes/${HASH}` }]
    const present = { rifffs: { g: { stems } } }
    const past = Array.from({ length: 100 }, () => ({ rifffs: { g: { stems } } }))
    const crossDraft = { parents: [{ sources: [{ stem: { path: `/x/${UUID}` } }] }] }
    expect(
      [...collectReonedNames([present, past, crossDraft, null, 3, new Float32Array(4)])].sort()
    ).toEqual([HASH, UUID].sort())
  })

  it('looks inside Maps and Sets, and survives a cycle', () => {
    const cyclic: Record<string, unknown> = { path: `/lib/.bakes/${HASH}` }
    cyclic.self = cyclic
    const map = new Map<string, unknown>([[`/k/${UUID}`, 1]])
    expect([...collectReonedNames([cyclic, map, new Set(['nothing'])])].sort()).toEqual(
      [HASH, UUID].sort()
    )
  })
})

describe('file names in .bakes', () => {
  it('tells copies from temporaries', () => {
    expect(isReonedCopyFileName(HASH)).toBe(true)
    expect(isReonedCopyFileName(UUID)).toBe(true)
    expect(isReonedCopyFileName(`.${HASH}.0f0f.baking.wav`)).toBe(false)
    expect(isStaleTempFileName(`.${HASH}.0f0f.baking.wav`)).toBe(true)
    expect(isStaleTempFileName('.6f1c2a9e-1b2c.baking.wav')).toBe(true) // the old temp naming
    expect(isStaleTempFileName(HASH)).toBe(false)
    expect(isReonedCopyFileName('.DS_Store')).toBe(false)
  })
})
