import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateDefaultProjectName } from './projectFile'

// vi.mock calls are hoisted to the top of the file by vitest's own
// transform, but ONLY when they're a top-level statement (not nested
// inside a describe/beforeEach callback) -- must sit here, matching
// pluginCatalog.test.ts's own exact placement, not nested further down.
// generateDefaultProjectName itself never calls app.getPath, so this mock
// being globally active for the whole file doesn't affect its own tests
// below -- it's simply unused for those.
let userDataDir: string
let musicDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'music' ? musicDir : userDataDir)
  }
}))

describe('generateDefaultProjectName', () => {
  it('formats as YYYY-MM-DD-adjective-noun + emoji for a given date', () => {
    const name = generateDefaultProjectName(new Date(2026, 7, 1)) // August 1, 2026
    expect(name).toMatch(/^2026-08-01-[a-z]+-[a-z]+-\p{Extended_Pictographic}$/u)
  })

  it('zero-pads single-digit month and day', () => {
    const name = generateDefaultProjectName(new Date(2026, 0, 5)) // January 5, 2026
    expect(name).toMatch(/^2026-01-05-[a-z]+-[a-z]+-\p{Extended_Pictographic}$/u)
  })

  it('varies the adjective-noun pair across calls (not a fixed pair)', () => {
    const date = new Date(2026, 7, 1)
    const names = new Set(Array.from({ length: 20 }, () => generateDefaultProjectName(date)))
    expect(names.size).toBeGreaterThan(1)
  })

  it('varies the emoji across calls (not a fixed one)', () => {
    const date = new Date(2026, 7, 1)
    const emojis = new Set(
      Array.from({ length: 30 }, () => generateDefaultProjectName(date).split('-').pop())
    )
    expect(emojis.size).toBeGreaterThan(1)
  })
})

describe('library-aware project functions', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-userdata-test-'))
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-music-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(musicDir, { recursive: true, force: true })
  })

  describe('saveProjectToLibrary', () => {
    it('creates the sketch folder and writes the project file, no dialog involved', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      const { sketchProjectPath } = await import('./projectLibrary')
      const result = saveProjectToLibrary('my-sketch', '{"bpm":120}')
      expect(result.path).toBe(sketchProjectPath('my-sketch'))
      expect(existsSync(result.path)).toBe(true)
      expect(readFileSync(result.path, 'utf-8')).toBe('{"bpm":120}')
    })

    it('overwrites in place on a second call with the same name', async () => {
      const { saveProjectToLibrary } = await import('./projectFile')
      saveProjectToLibrary('my-sketch', '{"bpm":120}')
      const result = saveProjectToLibrary('my-sketch', '{"bpm":140}')
      expect(readFileSync(result.path, 'utf-8')).toBe('{"bpm":140}')
    })
  })

  describe('saveProjectInPlace', () => {
    it('writes json directly to the given path with no dialog', async () => {
      const { saveProjectInPlace } = await import('./projectFile')
      const path = join(userDataDir, 'external.sssketchproj')
      saveProjectInPlace(path, '{"bpm":100}')
      expect(readFileSync(path, 'utf-8')).toBe('{"bpm":100}')
    })
  })

  describe('openLibrarySketch', () => {
    it('reads back a previously-saved library sketch', async () => {
      const { saveProjectToLibrary, openLibrarySketch } = await import('./projectFile')
      saveProjectToLibrary('readback-sketch', '{"bpm":90}')
      const result = openLibrarySketch('readback-sketch')
      expect(result).not.toBeNull()
      expect(result!.json).toBe('{"bpm":90}')
    })

    it('returns null for a sketch that does not exist', async () => {
      const { openLibrarySketch } = await import('./projectFile')
      expect(openLibrarySketch('nonexistent')).toBeNull()
    })
  })

  describe('duplicateSketchAsNewVersion', () => {
    it('copies the current sketch json into a new -2 named sketch', async () => {
      const { saveProjectToLibrary, duplicateSketchAsNewVersion, openLibrarySketch } =
        await import('./projectFile')
      saveProjectToLibrary('outdoor-jam', '{"bpm":128}')
      const result = duplicateSketchAsNewVersion('outdoor-jam')
      expect(result).not.toBeNull()
      expect(result!.name).toBe('outdoor-jam-2')
      const reopened = openLibrarySketch('outdoor-jam-2')
      expect(reopened!.json).toBe('{"bpm":128}')
    })

    it('returns null when the source sketch does not exist', async () => {
      const { duplicateSketchAsNewVersion } = await import('./projectFile')
      expect(duplicateSketchAsNewVersion('does-not-exist')).toBeNull()
    })
  })
})
