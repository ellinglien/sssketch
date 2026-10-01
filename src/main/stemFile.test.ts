import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isUsableStemFile } from './stemFile'

describe('isUsableStemFile', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sssketch-stemfile-test-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is true for a file with audio in it', () => {
    const path = join(dir, 'stem')
    writeFileSync(path, 'ogg bytes')
    expect(isUsableStemFile(path)).toBe(true)
  })

  // The real 2026-10-01 case: 2,361 0-byte placeholders left in a LORE
  // archive by an unfinished download. Existing, but not audio.
  it('is false for a 0-byte placeholder', () => {
    const path = join(dir, 'stem')
    writeFileSync(path, '')
    expect(isUsableStemFile(path)).toBe(false)
  })

  it('is false for a missing file, and never throws', () => {
    expect(isUsableStemFile(join(dir, 'nope'))).toBe(false)
    expect(isUsableStemFile(join(dir, 'no', 'such', 'dir'))).toBe(false)
  })

  it('is false for a directory', () => {
    const path = join(dir, 'sub')
    mkdirSync(path)
    expect(isUsableStemFile(path)).toBe(false)
  })
})
