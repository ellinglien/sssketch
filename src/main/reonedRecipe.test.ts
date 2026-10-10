import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BAKER_VERSION, recipeName, resolveRecipe, rotationKeyFor } from './reonedRecipe'

const source = { path: '/lib/stems/abc.wav', size: 1000, mtimeMs: 1_700_000_000_123.456 }

describe('recipeName', () => {
  it('is a 32-hex name with the .baked.wav suffix, stable for the same inputs', () => {
    const a = recipeName(source, { samples: 250 })
    expect(a).toMatch(/^[0-9a-f]{32}\.baked\.wav$/)
    expect(recipeName({ ...source }, { samples: 250 })).toBe(a)
    // Sub-millisecond mtime noise is not part of the identity.
    expect(recipeName({ ...source, mtimeMs: 1_700_000_000_123.9 }, { samples: 250 })).toBe(a)
  })

  it('changes with the source path, size or mtime', () => {
    const a = recipeName(source, { samples: 250 })
    expect(recipeName({ ...source, path: '/lib/stems/abd.wav' }, { samples: 250 })).not.toBe(a)
    expect(recipeName({ ...source, size: 1001 }, { samples: 250 })).not.toBe(a)
    expect(recipeName({ ...source, mtimeMs: source.mtimeMs + 1000 }, { samples: 250 })).not.toBe(a)
  })

  it('changes with the rotation and with the baker version', () => {
    const a = recipeName(source, { samples: 250 })
    expect(recipeName(source, { samples: 251 })).not.toBe(a)
    expect(recipeName(source, { seconds: 0.25 })).not.toBe(a)
    expect(recipeName(source, { samples: 250 }, BAKER_VERSION + 1)).not.toBe(a)
  })
})

describe('rotationKeyFor', () => {
  it('rounds to whole samples when the rate is known, so float noise names one file', () => {
    expect(rotationKeyFor(0.25, 1000)).toEqual({ samples: 250 })
    expect(rotationKeyFor(0.2500000001, 1000)).toEqual({ samples: 250 })
    expect(rotationKeyFor(0.25, null)).toEqual({ seconds: 0.25 })
  })
})

describe('resolveRecipe', () => {
  it('reads the identity and rate from disk and hands back the quantised rotation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recipe-'))
    try {
      const path = join(dir, 'src.wav')
      const header = Buffer.alloc(44)
      header.write('RIFF', 0)
      header.writeUInt32LE(36, 4)
      header.write('WAVEfmt ', 8)
      header.writeUInt32LE(16, 16)
      header.writeUInt16LE(1, 20)
      header.writeUInt16LE(1, 22)
      header.writeUInt32LE(1000, 24)
      header.writeUInt32LE(2000, 28)
      header.writeUInt16LE(2, 32)
      header.writeUInt16LE(16, 34)
      header.write('data', 36)
      writeFileSync(path, header)
      utimesSync(path, 1_700_000_000, 1_700_000_000)
      const r = await resolveRecipe(path, 0.2504)
      expect(r.sourcePath).toBe(path)
      expect(r.rotationFrames).toBe(250)
      expect(r.rotationSec).toBe(0.25)
      expect(r.name).toBe(
        recipeName({ path, size: 44, mtimeMs: 1_700_000_000_000 }, { samples: 250 })
      )
      await expect(resolveRecipe(join(dir, 'gone.wav'), 0.25)).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keys an unrecognised format by seconds, and renders those same rounded seconds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recipe-'))
    try {
      const path = join(dir, 'mystery')
      writeFileSync(path, 'not audio we can read the header of')
      const r = await resolveRecipe(path, 0.123456789)
      expect(r.rotationFrames).toBeNull()
      expect(r.rotationSec).toBe(0.123457) // the same rounding the name uses
      expect(r.name).toMatch(/^[0-9a-f]{32}\.baked\.wav$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
