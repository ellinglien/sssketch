import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createStemExportFileNameAllocator,
  externalDawExportLocation,
  prepareExternalStemsDir
} from './exportFileNames'

describe('createStemExportFileNameAllocator', () => {
  it('reserves generated suffixes against later real names', () => {
    const allocate = createStemExportFileNameAllocator()
    expect([allocate('riff', 'A'), allocate('riff', 'A'), allocate('riff', 'A-2')]).toEqual([
      'riff-A.wav',
      'riff-A-2.wav',
      'riff-A-2-2.wav'
    ])
  })

  it('treats case-only differences as collisions', () => {
    const allocate = createStemExportFileNameAllocator()
    expect([allocate('Riff', 'Kick'), allocate('riff', 'kick')]).toEqual([
      'Riff-Kick.wav',
      'riff-kick-2.wav'
    ])
  })

  it('shares one namespace between toolkit renders, dry stems, and reserved files', () => {
    const allocate = createStemExportFileNameAllocator()
    allocate.reserve('risers.wav')
    expect(allocate('riff', 'A', 'toolkit')).toBe('riff-A-toolkit.wav')
    expect(allocate('riff', 'A-toolkit')).toBe('riff-A-toolkit-2.wav')
    expect(allocate('RISERS', '')).not.toBe('risers.wav')
  })
})

describe('externalDawExportLocation', () => {
  it('isolates sketches in the same source directory', () => {
    expect(externalDawExportLocation('/music/a.sssketchproj', 'Ableton')).toEqual({
      projectName: 'a',
      outputDir: '/music/Ableton/a'
    })
    expect(externalDawExportLocation('/music/b.sssketchproj', 'Ableton')).toEqual({
      projectName: 'b',
      outputDir: '/music/Ableton/b'
    })
  })
})

describe('prepareExternalStemsDir', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sssketch-stems-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('gives each external sketch its own Stems/<name>/ folder', () => {
    expect(prepareExternalStemsDir(join(dir, 'a.sssketchproj'))).toEqual({
      projectName: 'a',
      outputDir: join(dir, 'Stems', 'a')
    })
    expect(existsSync(join(dir, 'Stems', 'a'))).toBe(true)
  })

  it("leaves a sibling sketch's stems and the user's own Stems files alone", () => {
    const a = prepareExternalStemsDir(join(dir, 'a.sssketchproj')).outputDir
    writeFileSync(join(a, 'a-drums.wav'), 'a')
    writeFileSync(join(dir, 'Stems', 'mine.wav'), 'mine')
    prepareExternalStemsDir(join(dir, 'b.sssketchproj'))
    expect(existsSync(join(a, 'a-drums.wav'))).toBe(true)
    expect(existsSync(join(dir, 'Stems', 'mine.wav'))).toBe(true)
  })

  it("re-exporting a sketch clears that sketch's own previous stems", () => {
    const a = prepareExternalStemsDir(join(dir, 'a.sssketchproj')).outputDir
    writeFileSync(join(a, 'a-removed-bus.wav'), 'stale')
    prepareExternalStemsDir(join(dir, 'a.sssketchproj'))
    expect(existsSync(join(a, 'a-removed-bus.wav'))).toBe(false)
  })

  it('never clears a folder that held files before sssketch first wrote there', () => {
    const a = join(dir, 'Stems', 'a')
    mkdirSync(a, { recursive: true })
    writeFileSync(join(a, 'my-own-take.wav'), 'mine')
    prepareExternalStemsDir(join(dir, 'a.sssketchproj'))
    prepareExternalStemsDir(join(dir, 'a.sssketchproj'))
    expect(existsSync(join(a, 'my-own-take.wav'))).toBe(true)
  })
})
